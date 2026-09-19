"""Non-blocking, durable HTTPS export for Edge events.

ONEAPI callbacks only call ``submit``.  A worker persists events to SQLite and
sends batches over HTTPS, so tester callbacks never perform network I/O.
"""
import json
import logging
import os
import queue
import sqlite3
import ssl
import threading
import time
import gzip
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


class HttpsOutboxExporter:
    def __init__(self, endpoint, token="", outbox="/tmp/grp6_export.sqlite3",
                 edge_id="grp6-edge", max_queue=32, batch_size=1,
                 timeout_seconds=5.0):
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != "https" and not (
                parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
            raise ValueError("GRP6_EXPORT_URL must use HTTPS (HTTP is allowed only for localhost)")
        self.endpoint = endpoint
        self.token = token
        self.edge_id = edge_id
        self.outbox = Path(outbox)
        self.max_queue = int(max_queue)
        self.batch_size = int(batch_size)
        self.timeout_seconds = float(timeout_seconds)
        self.pending = queue.Queue(maxsize=self.max_queue)
        self.stop_event = threading.Event()
        self.stats = {"accepted": 0, "dropped": 0, "delivered": 0, "failed": 0}
        self.worker = threading.Thread(target=self._run, name="grp6-exporter", daemon=True)
        self.worker.start()

    @classmethod
    def from_env(cls):
        endpoint = os.environ.get("GRP6_EXPORT_URL", "").strip()
        if not endpoint:
            return None
        return cls(
            endpoint=endpoint,
            token=os.environ.get("GRP6_EXPORT_TOKEN", ""),
            outbox=os.environ.get("GRP6_EXPORT_OUTBOX", "/tmp/grp6_export.sqlite3"),
            edge_id=os.environ.get("GRP6_EDGE_ID", "grp6-edge"),
            max_queue=int(os.environ.get("GRP6_EXPORT_QUEUE", "32")),
            batch_size=int(os.environ.get("GRP6_EXPORT_BATCH", "1")),
            timeout_seconds=float(os.environ.get("GRP6_EXPORT_TIMEOUT", "5")),
        )

    def submit(self, event):
        """Copy an event into the bounded memory queue without blocking."""
        item = dict(event)
        item.setdefault("event_id", str(uuid.uuid4()))
        try:
            self.pending.put_nowait(item)
            self.stats["accepted"] += 1
            return True
        except queue.Full:
            self.stats["dropped"] += 1
            return False

    def close(self, timeout=5.0):
        self.stop_event.set()
        self.worker.join(timeout)

    def _connect(self):
        self.outbox.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(self.outbox), timeout=5.0)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS outbox (
            event_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at REAL NOT NULL DEFAULT 0,
            last_error TEXT
        )""")
        db.commit()
        return db

    def _persist_pending(self, db):
        wrote = False
        while True:
            try:
                event = self.pending.get_nowait()
            except queue.Empty:
                break
            payload = json.dumps(event, ensure_ascii=False, allow_nan=False,
                                 separators=(",", ":"))
            db.execute("INSERT OR IGNORE INTO outbox(event_id,payload) VALUES (?,?)",
                       (event["event_id"], payload))
            self.pending.task_done()
            wrote = True
        if wrote:
            db.commit()

    def _ready(self, db):
        rows = db.execute(
            "SELECT event_id,payload,attempts FROM outbox WHERE available_at<=? "
            "ORDER BY rowid LIMIT ?", (time.time(), self.batch_size)).fetchall()
        return [(event_id, json.loads(payload), attempts)
                for event_id, payload, attempts in rows]

    def _post(self, events):
        batch = {
            "schema_version": "1",
            "edge_id": self.edge_id,
            "batch_id": str(uuid.uuid4()),
            "events": events,
        }
        body = gzip.compress(json.dumps(batch, ensure_ascii=False, allow_nan=False).encode("utf-8"))
        headers = {"Content-Type": "application/json", "Content-Encoding": "gzip",
                   "Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=self.timeout_seconds,
                                    context=ssl.create_default_context()) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError("export HTTP status {}".format(response.status))
            response.read()

    def _run(self):
        db = None
        try:
            db = self._connect()
            while not self.stop_event.is_set() or not self.pending.empty():
                self._persist_pending(db)
                rows = self._ready(db)
                if not rows:
                    self.stop_event.wait(0.25)
                    continue
                ids = [row[0] for row in rows]
                try:
                    self._post([row[1] for row in rows])
                    db.executemany("DELETE FROM outbox WHERE event_id=?", [(value,) for value in ids])
                    db.commit()
                    self.stats["delivered"] += len(ids)
                except Exception as exc:
                    self.stats["failed"] += len(ids)
                    now = time.time()
                    for event_id, _, attempts in rows:
                        delay = min(30.0, 0.5 * (2 ** min(attempts, 6)))
                        db.execute("UPDATE outbox SET attempts=?,available_at=?,last_error=? "
                                   "WHERE event_id=?",
                                   (attempts + 1, now + delay, str(exc)[:500], event_id))
                    db.commit()
                    logging.warning("grp6 HTTPS export failed; retained in outbox: %s", exc)
                    self.stop_event.wait(min(2.0, delay))
        except Exception:
            logging.exception("grp6 exporter worker stopped unexpectedly")
        finally:
            if db is not None:
                try:
                    self._persist_pending(db)
                finally:
                    db.close()
