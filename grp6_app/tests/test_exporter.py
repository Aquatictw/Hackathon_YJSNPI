import gzip
import json
import socket
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from grp6_app.exporter import HttpsOutboxExporter


def event(identity, **extra):
    return dict(schema_version="1", event_id=identity, sequence=1, mode="replay",
                event_type="device_completed", timestamp=1, tester_id="tester",
                run_id="run", **extra)


def ack(batch, accepted=None, duplicates=None, rejected=None):
    return json.dumps({"batch_id": batch["batch_id"], "accepted": accepted or [],
                       "duplicates": duplicates or [], "rejected": rejected or []}).encode()


class ExporterPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        with patch("threading.Thread.start"):
            self.exporter = HttpsOutboxExporter("http://localhost/ingest",
                outbox=Path(self.folder.name) / "outbox.sqlite3", batch_size=10)
        self.db = self.exporter._connect()
        self.addCleanup(self.db.close)

    def enqueue(self, *events):
        for value in events:
            self.assertTrue(self.exporter.submit(value))
        self.exporter._persist_pending(self.db)
        return self.exporter._ready(self.db)

    def ids(self):
        return [r[0] for r in self.db.execute("SELECT event_id FROM outbox ORDER BY rowid")]

    def send(self, rows, status=200, body=None, retry_after=None):
        batch = self.exporter._batch([r[1] for r in rows])
        with patch.object(self.exporter, "_post", return_value=(status, body or ack(batch), retry_after)):
            self.exporter._send_rows(self.db, rows)

    def test_partial_ack_retires_only_accepted_duplicates_and_preserves_rejection(self):
        rows = self.enqueue(*(event(i) for i in "abcd"))
        batch = self.exporter._batch([r[1] for r in rows])
        self.send(rows, body=ack(batch, ["a"], ["b"], [{"event_id": "c", "reason": "invalid"}]))
        self.assertEqual(self.ids(), ["d"])
        saved = self.db.execute("SELECT event_id,payload,reason FROM quarantine").fetchone()
        self.assertEqual((saved[0], json.loads(saved[1]), saved[2]), ("c", event("c"), "remote_rejected"))
        self.assertEqual(self.db.execute("SELECT last_error FROM outbox").fetchone()[0], "missing_ack")
        self.assertEqual(self.exporter.stats["delivered"], 2)
        reopened = sqlite3.connect(self.exporter.outbox)
        with reopened:
            self.assertEqual(reopened.execute("SELECT event_id FROM quarantine").fetchone()[0], "c")
            self.assertEqual(reopened.execute("SELECT event_id FROM outbox").fetchone()[0], "d")
        reopened.close()

    def test_malformed_mismatched_and_foreign_ack_never_retire(self):
        rows = self.enqueue(event("a"))
        batch = self.exporter._batch([rows[0][1]])
        bodies = [b'{"accepted":true}', b'null', b'not json', b'\xff',
                  ack({"batch_id": "other"}, ["a"]), ack(batch, ["foreign"]),
                  ack(batch, ["a", "a"]), ack(batch, ["a"], ["a"]),
                  ack(batch, ["a"], rejected=[{"event_id": "a", "reason": "no"}]),
                  ack(batch, rejected=["a"]), b'x' * (self.exporter.MAX_ACK_BYTES + 1)]
        for body in bodies:
            with self.subTest(body=body[:80]):
                self.send(rows, body=body)
                self.assertEqual(self.ids(), ["a"])
                self.assertEqual(self.exporter.stats["delivered"], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0], 0)

    def test_bad_request_and_validation_errors_quarantine_without_loss(self):
        for status in (400, 422):
            rows = self.enqueue(event(str(status)))
            self.send(rows, status=status)
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.db.execute("SELECT event_id,reason FROM quarantine ORDER BY id").fetchall(),
                         [("400", "http_400"), ("422", "http_422")])

    def test_identity_conflict_isolates_named_event_and_retains_uncommitted_peers(self):
        rows = self.enqueue(event("a"), event("b"))
        self.send(rows, status=409, body=b'{"conflicting_ids":["a"]}')
        self.assertEqual(self.ids(), ["b"])
        self.assertEqual(self.db.execute("SELECT event_id FROM quarantine").fetchone()[0], "a")
        self.assertEqual(self.exporter.stats["delivered"], 0)

    def test_unattributed_identity_conflict_preserves_whole_batch_for_review(self):
        rows = self.enqueue(event("a"), event("b"))
        self.send(rows, status=409, body=b'{"conflicting_ids":["projection-id"]}')
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.db.execute("SELECT event_id FROM quarantine ORDER BY id").fetchall(), [("a",), ("b",)])
        self.assertEqual(self.exporter.stats["delivered"], 0)

    def test_413_splits_and_quarantines_only_oversized_singleton(self):
        rows = self.enqueue(*(event(i) for i in "abc"))
        seen = []
        def post(batch):
            ids = [e["event_id"] for e in batch["events"]]
            seen.append((batch["batch_id"], ids))
            if len(ids) > 1 or ids == ["b"]:
                return 413, b'{}', None
            return 200, ack(batch, ids), None
        with patch.object(self.exporter, "_post", side_effect=post):
            self.exporter._send_rows(self.db, rows)
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.exporter.stats["delivered"], 2)
        self.assertEqual(self.db.execute("SELECT event_id,reason FROM quarantine").fetchall(), [("b", "http_413")])
        self.assertEqual(len({x[0] for x in seen}), len(seen))

    def test_retry_statuses_preserve_payload_and_record_actionable_reason(self):
        rows = self.enqueue(event("a"))
        original = self.db.execute("SELECT payload FROM outbox").fetchone()[0]
        for status in (401, 403, 429, 500, 503, 302):
            with self.subTest(status=status), patch("grp6_app.exporter.time.time", return_value=1000), \
                    patch("grp6_app.exporter.random.uniform", return_value=1):
                self.send(rows, status=status, retry_after="45")
                payload, due, reason = self.db.execute("SELECT payload,available_at,last_error FROM outbox").fetchone()
                self.assertEqual(payload, original)
                self.assertEqual(due, 1045)
                self.assertIn(str(status), reason)
                if status in (401, 403):
                    self.assertIn("auth_required", reason)
        self.assertEqual(self.exporter.stats["delivered"], 0)

    def test_network_failure_does_not_persist_or_log_exception_secrets(self):
        rows = self.enqueue(event("a"))
        with patch.object(self.exporter, "_post", side_effect=OSError("secret-token")), \
                self.assertLogs(level="WARNING") as logs:
            self.exporter._send_rows(self.db, rows)
        self.assertNotIn("secret-token", str(logs.output))
        self.assertEqual(self.db.execute("SELECT last_error FROM outbox").fetchone()[0], "network_error")

    def test_retry_after_date_and_invalid_values(self):
        with patch("grp6_app.exporter.time.time", return_value=0):
            self.assertEqual(self.exporter._retry_after("Thu, 01 Jan 1970 00:01:00 GMT"), 60)
        for value in (None, "bad", "NaN", "inf", "-1"):
            self.assertEqual(self.exporter._retry_after(value), 0)
        self.assertEqual(self.exporter._retry_after("999999"), 86400)

    def test_batch_identity_survives_restart_and_changes_with_content(self):
        rows = self.enqueue(event("a", nested={"x": [1]}))
        batch = self.exporter._batch([rows[0][1]])
        with patch("threading.Thread.start"):
            restarted = HttpsOutboxExporter("http://localhost/ingest", outbox=self.exporter.outbox)
        self.assertEqual(batch, restarted._batch([json.loads(self.db.execute("SELECT payload FROM outbox").fetchone()[0])]))
        self.assertNotEqual(batch["batch_id"], restarted._batch([event("b")])["batch_id"])

    def test_submit_snapshots_nested_values_and_local_conflict_preserves_both(self):
        value = event("a", nested={"x": [1]})
        self.exporter.submit(value)
        value["nested"]["x"].append(2)
        self.exporter._persist_pending(self.db)
        self.enqueue(event("a", nested={"x": [1]}), value)
        self.assertEqual(json.loads(self.db.execute("SELECT payload FROM outbox").fetchone()[0])["nested"], {"x": [1]})
        rejected = self.db.execute("SELECT payload,reason FROM quarantine").fetchall()
        self.assertEqual(len(rejected), 1)
        self.assertEqual(json.loads(rejected[0][0])["nested"], {"x": [1, 2]})
        self.assertEqual(rejected[0][1], "local_identity_conflict")

    def test_invalid_events_do_not_poison_valid_queued_data(self):
        cycle = {}; cycle["self"] = cycle
        self.enqueue(event("nan", value=float("nan")), event("inf", value=float("inf")),
                     event("object", value=object()), event("cycle", value=cycle),
                     event("surrogate", value="\ud800"), event(None), event("valid"))
        self.assertEqual(self.ids(), ["valid"])
        self.assertEqual(self.exporter.stats["quarantined"], 6)
        self.assertIn("NaN", self.db.execute("SELECT payload FROM quarantine WHERE event_id='nan'").fetchone()[0])
        self.assertEqual(self.exporter.pending.unfinished_tasks, 0)

    def test_disk_failure_rolls_back_and_keeps_memory_for_retry(self):
        self.db.execute("CREATE TRIGGER fail_insert BEFORE INSERT ON outbox WHEN NEW.event_id='b' "
                        "BEGIN SELECT RAISE(ABORT,'disk failure'); END")
        self.exporter.submit(event("a")); self.exporter.submit(event("b"))
        with self.assertRaises(sqlite3.Error):
            self.exporter._persist_pending(self.db)
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.exporter.pending.unfinished_tasks, 2)
        self.db.execute("DROP TRIGGER fail_insert")
        self.exporter._persist_pending(self.db)
        self.assertEqual(self.ids(), ["a", "b"])
        self.assertEqual(self.exporter.pending.unfinished_tasks, 0)

    def test_invalid_legacy_outbox_rows_are_preserved_without_stopping_recovery(self):
        broken = [("corrupt", "{"), ("nan", json.dumps(event("nan", value=float("nan")))),
                  ("mismatch", json.dumps(event("other"))), ("array", "[]")]
        with self.db:
            self.db.executemany("INSERT INTO outbox(event_id,payload) VALUES (?,?)", broken)
        # An incoming reuse of a corrupt ID must not overwrite its stored evidence.
        rows = self.enqueue(event("corrupt"), event("valid"))
        self.assertEqual([row[0] for row in rows], ["valid"])
        self.assertEqual(self.ids(), ["valid"])
        preserved = self.db.execute("SELECT event_id,payload FROM quarantine "
                                    "WHERE reason='invalid_persisted_event' ORDER BY id").fetchall()
        self.assertEqual(preserved, broken)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quarantine "
                                         "WHERE reason='local_identity_conflict'").fetchone()[0], 1)

    def test_ack_and_rejection_transaction_rolls_back_together(self):
        rows = self.enqueue(event("a"), event("b"))
        self.db.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON outbox WHEN OLD.event_id='b' "
                        "BEGIN SELECT RAISE(ABORT,'disk failure'); END")
        batch = self.exporter._batch([r[1] for r in rows])
        with self.assertRaises(sqlite3.Error):
            self.send(rows, body=ack(batch, ["a"], rejected=[{"event_id": "b", "reason": "invalid"}]))
        self.assertEqual(self.ids(), ["a", "b"])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0], 0)
        self.assertEqual(self.exporter.stats["delivered"], 0)

    def test_queue_is_bounded_and_closed_exporter_refuses_work(self):
        for i in range(self.exporter.max_queue):
            self.assertTrue(self.exporter.submit(event(str(i))))
        self.assertFalse(self.exporter.submit(event("overflow")))
        self.exporter.stop_event.set()
        self.assertFalse(self.exporter.submit(event("closed")))


class ExporterHTTPTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "outbox.sqlite3"
        self.batches = []
        self.response = lambda batch: (200, ack(batch, [e["event_id"] for e in batch["events"]]), {})
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                batch = json.loads(gzip.decompress(body))
                outer.batches.append(batch)
                result = outer.response(batch)
                if result is None:
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                status, raw, headers = result
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(raw)
            def log_message(self, *_):
                pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = "http://127.0.0.1:{}/api/v1/events/batch".format(self.server.server_port)

    def exporter(self):
        exporter = HttpsOutboxExporter(self.url, outbox=self.path, timeout_seconds=1)
        self.addCleanup(exporter.close)
        return exporter

    def wait_for(self, predicate):
        deadline = time.monotonic() + 5
        while not predicate() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(predicate())

    def test_lost_ack_retries_same_batch_and_accepts_duplicate(self):
        def response(batch):
            if len(self.batches) == 1:
                return None
            return 200, ack(batch, duplicates=["a"]), {}
        self.response = response
        exporter = self.exporter()
        self.assertTrue(exporter.submit(event("a")))
        self.wait_for(lambda: exporter.stats["delivered"] == 1)
        self.assertEqual(self.batches[0], self.batches[1])
        self.assertEqual(self.batches[0]["schema_version"], "1")
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0], 0)

    def test_outage_shutdown_and_restart_recover_persisted_event(self):
        self.response = lambda batch: (503, b'{}', {"Retry-After": "3600"})
        first = self.exporter()
        first.submit(event("a"))
        self.wait_for(lambda: first.stats["failed"] == 1)
        first.close()
        self.assertFalse(first.worker.is_alive())
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT event_id FROM outbox").fetchone()[0], "a")
            db.execute("UPDATE outbox SET available_at=0")
            db.commit()
        self.response = lambda batch: (200, ack(batch, ["a"]), {})
        second = self.exporter()
        self.wait_for(lambda: second.stats["delivered"] == 1)
        self.assertEqual(self.batches[0], self.batches[-1])

    def test_submit_does_not_wait_for_http_and_close_flushes_pending(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        def response(batch):
            entered.set()
            release.wait(3)
            return 200, ack(batch, ["a"]), {}
        self.response = response
        exporter = self.exporter()
        exporter.submit(event("a"))
        self.assertTrue(entered.wait(3))
        submitted = threading.Event()
        def submit():
            exporter.submit(event("b"))
            submitted.set()
        threading.Thread(target=submit, daemon=True).start()
        self.assertTrue(submitted.wait(.5), "submit waited for blocked HTTP")
        exporter.close(timeout=.01)
        release.set()
        exporter.close()
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT event_id FROM outbox").fetchall(), [("b",)])
        self.assertFalse(exporter.worker.is_alive())

    def test_redirect_is_not_followed(self):
        self.response = lambda batch: (302, b'{}', {"Location": self.url + "-redirect"})
        exporter = self.exporter()
        exporter.submit(event("a"))
        self.wait_for(lambda: exporter.stats["failed"] == 1)
        self.assertEqual(len(self.batches), 1)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT last_error FROM outbox").fetchone()[0], "http_302")

    def test_invalid_event_does_not_stop_worker(self):
        exporter = self.exporter()
        exporter.submit(event("nan", value=float("nan")))
        exporter.submit(event("a"))
        self.wait_for(lambda: exporter.stats["delivered"] == 1)
        self.assertTrue(exporter.worker.is_alive())
        self.assertEqual(exporter.stats["quarantined"], 1)

    def test_public_http_and_invalid_limits_are_rejected(self):
        for url, kwargs in [("http://example.com/events", {}), ("https:///events", {}),
                            (self.url, {"max_queue": 0}), (self.url, {"batch_size": 101}),
                            (self.url, {"timeout_seconds": float("nan")})]:
            with self.subTest(url=url, kwargs=kwargs), self.assertRaises(ValueError):
                HttpsOutboxExporter(url, **kwargs)


if __name__ == "__main__":
    unittest.main()
