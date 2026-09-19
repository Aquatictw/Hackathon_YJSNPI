"""Background SQLite/HTTPS export; submit is a bounded, non-durable enqueue."""
import copy
import gzip
import hashlib
import json
import logging
import math
import os
import queue
import random
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.utils import parsedate_to_datetime
from pathlib import Path


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the ingest credential to a redirect target.
        return None


class HttpsOutboxExporter:
    MAX_ACK_BYTES = 262144

    def __init__(self, endpoint, token="", outbox="/tmp/grp6_export.sqlite3",
                 edge_id="grp6-edge", max_queue=32, batch_size=1,
                 timeout_seconds=5.0):
        parsed = urllib.parse.urlparse(endpoint)
        if not parsed.hostname or (parsed.scheme != "https" and not (
                parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"})):
            raise ValueError("GRP6_EXPORT_URL must use HTTPS (HTTP is allowed only for localhost)")
        if parsed.username or parsed.password or parsed.fragment:
            raise ValueError("Export URL must not contain credentials or a fragment")
        self.endpoint = endpoint
        self.token = token
        self.edge_id = edge_id
        self.outbox = Path(outbox)
        self.max_queue = int(max_queue)
        self.batch_size = int(batch_size)
        self.timeout_seconds = float(timeout_seconds)
        if self.max_queue < 1 or not 1 <= self.batch_size <= 100:
            raise ValueError("Export queue must be positive and batch size must be 1..100")
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("Export timeout must be finite and positive")
        if not isinstance(edge_id, str) or not 1 <= len(edge_id) <= 120:
            raise ValueError("Export edge ID must contain 1..120 characters")
        self.pending = queue.Queue(maxsize=self.max_queue)
        self._inflight = []
        self._submit_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.stats = {"accepted": 0, "dropped": 0, "delivered": 0, "failed": 0,
                      "quarantined": 0, "storage_errors": 0}
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
        """Snapshot nested data without disk/network I/O; True is NOT durable ACK."""
        with self._submit_lock:
            if self.stop_event.is_set():
                self.stats["dropped"] += 1
                return False
            try:
                item = copy.deepcopy(dict(event))
                item.setdefault("event_id", str(uuid.uuid4()))
                self.pending.put_nowait(item)
            except (queue.Full, TypeError, ValueError, RecursionError):
                self.stats["dropped"] += 1
                return False
            self.stats["accepted"] += 1
            return True

    def close(self, timeout=5.0):
        with self._submit_lock:
            self.stop_event.set()
        self.worker.join(timeout)

    def _connect(self):
        self.outbox.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(self.outbox), timeout=5.0)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS outbox (
                event_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                available_at REAL NOT NULL DEFAULT 0,
                last_error TEXT
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS quarantine (
                id INTEGER PRIMARY KEY, event_id TEXT, payload TEXT NOT NULL,
                reason TEXT NOT NULL, quarantined_at REAL NOT NULL,
                UNIQUE(event_id, payload, reason)
            )""")
            db.commit()
            return db
        except Exception:
            db.close()
            raise

    @staticmethod
    def _quarantine(db, event_id, payload, reason):
        db.execute("INSERT OR IGNORE INTO quarantine(event_id,payload,reason,quarantined_at) "
                   "VALUES (?,?,?,?)", (event_id, payload, reason, time.time()))

    def _persist_pending(self, db):
        # Keep dequeued items until COMMIT succeeds, including on a disk/lock error.
        if not self._inflight:
            for _ in range(self.max_queue):
                try:
                    self._inflight.append(self.pending.get_nowait())
                except queue.Empty:
                    break
        quarantined = 0
        with db:
            for event in self._inflight:
                event_id = event.get("event_id")
                try:
                    payload = json.dumps(event, ensure_ascii=False, allow_nan=False,
                                         sort_keys=True, separators=(",", ":"))
                    payload.encode("utf-8")
                    if not isinstance(event_id, str) or not 1 <= len(event_id) <= 120:
                        raise ValueError("invalid event ID")
                except (TypeError, ValueError, RecursionError, UnicodeError):
                    # Preserve nonfinite values for diagnosis, never silently replace
                    # them with zero/null or claim completeness. This is not wire JSON.
                    try:
                        raw = json.dumps(event, ensure_ascii=True)
                    except (TypeError, ValueError, RecursionError):
                        raw = repr(event).encode("utf-8", "backslashreplace").decode("utf-8")
                    safe_id = event_id if isinstance(event_id, str) else None
                    if safe_id is not None:
                        safe_id = safe_id.encode("utf-8", "backslashreplace").decode("utf-8")
                    self._quarantine(db, safe_id, raw, "invalid_local_event")
                    quarantined += 1
                    continue
                existing = db.execute("SELECT payload FROM outbox WHERE event_id=?",
                                      (event_id,)).fetchone()
                if existing:
                    # Older outboxes used unsorted JSON; compare decoded content.
                    try:
                        previous = self._decode_payload(event_id, existing[0])
                        canonical_existing = json.dumps(previous, ensure_ascii=False,
                                                        allow_nan=False, sort_keys=True, separators=(",", ":"))
                    except (ValueError, TypeError, RecursionError, UnicodeError):
                        canonical_existing = None
                    if canonical_existing != payload:
                        self._quarantine(db, event_id, payload, "local_identity_conflict")
                        quarantined += 1
                else:
                    db.execute("INSERT INTO outbox(event_id,payload) VALUES (?,?)",
                               (event_id, payload))
        self.stats["quarantined"] += quarantined
        for _ in self._inflight:
            self.pending.task_done()
        self._inflight.clear()

    @staticmethod
    def _decode_payload(event_id, payload):
        event = json.loads(payload)
        if (not isinstance(event, dict) or not isinstance(event_id, str)
                or not 1 <= len(event_id) <= 120 or event.get("event_id") != event_id):
            raise ValueError("invalid persisted event identity")
        json.dumps(event, ensure_ascii=False, allow_nan=False).encode("utf-8")
        return event

    def _ready(self, db):
        rows = db.execute(
            "SELECT event_id,payload,attempts FROM outbox WHERE available_at<=? "
            "ORDER BY rowid LIMIT ?", (time.time(), self.batch_size)).fetchall()
        ready = []
        quarantined = 0
        with db:
            for event_id, payload, attempts in rows:
                try:
                    event = self._decode_payload(event_id, payload)
                except (ValueError, TypeError, RecursionError, UnicodeError):
                    self._quarantine(db, event_id, payload, "invalid_persisted_event")
                    db.execute("DELETE FROM outbox WHERE event_id=?", (event_id,))
                    quarantined += 1
                else:
                    ready.append((event_id, event, attempts))
        self.stats["quarantined"] += quarantined
        return ready

    def _batch(self, events):
        batch = {"schema_version": "1", "edge_id": self.edge_id, "events": events}
        identity = json.dumps(batch, ensure_ascii=False, allow_nan=False,
                              sort_keys=True, separators=(",", ":")).encode("utf-8")
        # Same edge/content/order produces the same ID across retries and restarts.
        # Splitting or partial ACK changes membership and therefore the batch ID.
        batch["batch_id"] = hashlib.sha256(identity).hexdigest()
        return batch

    def _post(self, batch):
        body = gzip.compress(json.dumps(batch, ensure_ascii=False, allow_nan=False,
                                       sort_keys=True, separators=(",", ":")).encode("utf-8"), mtime=0)
        headers = {"Content-Type": "application/json", "Content-Encoding": "gzip",
                   "Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        opener = urllib.request.build_opener(
            _NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        try:
            response = opener.open(request, timeout=self.timeout_seconds)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            raw = response.read(self.MAX_ACK_BYTES + 1)
            return response.code, raw, response.headers.get("Retry-After")

    @staticmethod
    def _retry_after(value):
        if value is None:
            return 0
        try:
            seconds = float(value)
        except (TypeError, ValueError):
            try:
                seconds = parsedate_to_datetime(value).timestamp() - time.time()
            except (TypeError, ValueError, OverflowError):
                return 0
        return min(86400, max(0, seconds)) if math.isfinite(seconds) else 0

    def _defer(self, db, rows, reason, retry_after=None, minimum=0):
        now = time.time()
        with db:
            for event_id, _, attempts in rows:
                delay = min(30.0, 0.5 * 2 ** min(attempts, 6) * random.uniform(0.75, 1.25))
                delay = max(delay, minimum, self._retry_after(retry_after))
                db.execute("UPDATE outbox SET attempts=?,available_at=?,last_error=? WHERE event_id=?",
                           (attempts + 1, now + delay, reason, event_id))
        self.stats["failed"] += len(rows)
        # Never log bodies, URLs, or exception text that can echo credentials.
        logging.warning("grp6 HTTPS export retained %d event(s): %s", len(rows), reason)

    def _isolate(self, db, rows, reason):
        with db:
            for event_id, _, _ in rows:
                payload = db.execute("SELECT payload FROM outbox WHERE event_id=?",
                                     (event_id,)).fetchone()[0]
                self._quarantine(db, event_id, payload, reason)
                db.execute("DELETE FROM outbox WHERE event_id=?", (event_id,))
        self.stats["quarantined"] += len(rows)
        logging.warning("grp6 HTTPS export quarantined %d event(s): %s", len(rows), reason)

    def _ack(self, raw, batch):
        if len(raw) > self.MAX_ACK_BYTES:
            raise ValueError("oversized ACK")
        ack = json.loads(raw)
        if not isinstance(ack, dict) or ack.get("batch_id") != batch["batch_id"]:
            raise ValueError("mismatched ACK batch")
        known = {event["event_id"] for event in batch["events"]}
        seen = set()
        groups = []
        for name in ("accepted", "duplicates", "rejected"):
            values = ack.get(name)
            if not isinstance(values, list):
                raise ValueError("invalid ACK list")
            ids = set()
            for value in values:
                if name == "rejected":
                    if not isinstance(value, dict) or not isinstance(value.get("reason"), str):
                        raise ValueError("invalid rejection")
                    value = value.get("event_id")
                if not isinstance(value, str) or value not in known or value in seen:
                    raise ValueError("unknown or repeated ACK ID")
                ids.add(value)
                seen.add(value)
            groups.append(ids)
        return groups[0] | groups[1], groups[2]

    def _send_rows(self, db, rows):
        batch = self._batch([row[1] for row in rows])
        try:
            status, raw, retry_after = self._post(batch)
        except Exception:
            self._defer(db, rows, "network_error")
            return
        if 200 <= status < 300:
            try:
                delivered, rejected = self._ack(raw, batch)
            except (ValueError, TypeError, RecursionError, UnicodeError):
                self._defer(db, rows, "invalid_ack")
                return
            # ACK retirement and rejection preservation are one durable transaction.
            with db:
                for event_id, _, _ in rows:
                    if event_id in rejected:
                        payload = db.execute("SELECT payload FROM outbox WHERE event_id=?",
                                             (event_id,)).fetchone()[0]
                        self._quarantine(db, event_id, payload, "remote_rejected")
                    if event_id in delivered or event_id in rejected:
                        db.execute("DELETE FROM outbox WHERE event_id=?", (event_id,))
            self.stats["delivered"] += len(delivered)
            self.stats["quarantined"] += len(rejected)
            missing = [row for row in rows if row[0] not in delivered | rejected]
            if missing:
                self._defer(db, missing, "missing_ack", retry_after)
        elif status == 413 and len(rows) > 1:
            midpoint = len(rows) // 2
            self._send_rows(db, rows[:midpoint])
            self._send_rows(db, rows[midpoint:])
        elif status in (400, 422, 413):
            self._isolate(db, rows, "http_{}".format(status))
        elif status == 409:
            try:
                conflicts = json.loads(raw).get("conflicting_ids") if len(raw) <= self.MAX_ACK_BYTES else None
                if not isinstance(conflicts, list) or not all(isinstance(v, str) for v in conflicts):
                    conflicts = []
            except (ValueError, AttributeError, RecursionError, UnicodeError):
                conflicts = []
            affected = [row for row in rows if row[0] in conflicts]
            # Conflicts may name a batch/projection/evidence ID instead of a source.
            # Preserve the whole batch for review if attribution is unknown.
            self._isolate(db, affected or rows, "http_409_identity_conflict")
            if affected:
                remaining = [row for row in rows if row[0] not in conflicts]
                if remaining:
                    self._defer(db, remaining, "batch_identity_conflict")
        else:
            reason = "http_{}_auth_required".format(status) if status in (401, 403) else "http_{}".format(status)
            self._defer(db, rows, reason, retry_after, minimum=30 if status < 500 and status != 429 else 0)

    def _run(self):
        db = None
        try:
            while True:
                try:
                    if db is None:
                        db = self._connect()
                    self._persist_pending(db)
                    # Shutdown flushes memory to SQLite; persisted sends resume on restart.
                    if self.stop_event.is_set():
                        if not self._inflight and self.pending.empty():
                            break
                        continue
                    rows = self._ready(db)
                    if rows:
                        self._send_rows(db, rows)
                    else:
                        self.stop_event.wait(0.25)
                except (sqlite3.Error, OSError):
                    self.stats["storage_errors"] += 1
                    logging.error("grp6 exporter storage unavailable; queued data is not yet durable")
                    if db is not None:
                        db.close()
                        db = None
                    if self.stop_event.wait(1):
                        break
        finally:
            if db is not None:
                db.close()
