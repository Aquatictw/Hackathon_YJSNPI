#!/usr/bin/env python3
"""Durable HC EdgeLog bridge, Python 3.6+ stdlib only. See host-relay-README.md."""
import argparse
import contextlib
import datetime
import hashlib
import json
import math
import os
import re
import sqlite3
import ssl
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


MARKER = b'GRP6_EVIDENCE '
MAX_BODY = 3 * 1024 * 1024
MAX_ACK = 262144
DEFAULT_EDGE = 'grp6-hc-relay'


class RelayError(Exception):
    """Only fixed, non-sensitive reason codes may be exposed by the CLI."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def strict_json(value):
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError('duplicate_json_key')
            result[key] = item
        return result

    def constant(unused):
        raise ValueError('nonfinite_json')

    result = json.loads(value, object_pairs_hook=pairs, parse_constant=constant)
    canonical(result)  # Also rejects numeric overflow such as 1e999.
    return result


def identifier(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 120:
        raise ValueError('invalid_identity')
    # Reject lone surrogate codepoints before sending UTF-8 wire data.
    value.encode('utf-8')
    return value


def source_seconds(record):
    stamp = record.get('timestamp')
    if not isinstance(stamp, str):
        raise ValueError('missing_source_timestamp')
    match = re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$', stamp)
    if not match:
        raise ValueError('invalid_source_timestamp')
    date = datetime.datetime.strptime(match.group(1), '%Y-%m-%dT%H:%M:%S')
    fraction = match.group(2) or '.0'
    date = date.replace(microsecond=int(fraction[1:].ljust(6, '0')))
    zone = match.group(3)
    offset = 0
    if zone != 'Z':
        hours, minutes = int(zone[1:3]), int(zone[4:6])
        if hours > 23 or minutes > 59:
            raise ValueError('invalid_source_timezone')
        offset = (hours * 60 + minutes) * (1 if zone[0] == '+' else -1)
    seconds = date.replace(tzinfo=datetime.timezone(
        datetime.timedelta(minutes=offset))).timestamp()
    original = record.get('time', seconds)
    if (type(original) not in (int, float) or not math.isfinite(original)
            or not 0 <= original <= 8640000000 or abs(original - seconds) > 0.000002):
        raise ValueError('inconsistent_source_time')
    return original


def to_event(record, recorded=False):
    """Map only present fields; never infer scope, measurements or receipts."""
    if not isinstance(record, dict) or type(record.get('schema_version')) is not int or record['schema_version'] != 1:
        raise ValueError('invalid_raw_schema')
    event_id = identifier(record.get('event_id'))
    run_id = identifier(record.get('run_id'))
    tester_id = identifier(record.get('tester'))
    kind = identifier(record.get('kind'))
    sequence = record.get('sequence')
    if type(sequence) is not int or sequence < 0:
        raise ValueError('invalid_sequence')
    mode = record.get('source_mode')
    if mode not in ('live', 'replay', 'simulation'):
        raise ValueError('invalid_source_mode')
    event = dict(record)
    event.update(schema_version='1', event_id=event_id, run_id=run_id,
                 tester_id=tester_id, event_type=kind, sequence=sequence,
                 timestamp=source_seconds(record), mode='replay' if recorded else mode)
    # Keep original ISO timestamp and every original field in raw_record.
    event['raw_record'] = record
    event['host_relay'] = {
        'version': 1, 'transport': 'host_edgelog',
        'capture_mode': 'recorded' if recorded else 'poll',
        'source_mode': mode, 'source_timestamp': record['timestamp'],
        'freshness': 'source_time_only',
    }
    for raw_key, wire_key in (('lot', 'lot_id'), ('wafer', 'wafer_id')):
        value = record.get(raw_key)
        if value is None or value == '':
            event[wire_key] = None
        elif isinstance(value, str) or type(value) is int:
            event[wire_key] = identifier(str(value))
        else:
            raise ValueError('invalid_scope')
    # Explicitly retain original mode in raw_record, but do not expose live as
    # the operational source_mode of a saved-capture import.
    event['source_mode'] = event['mode']
    return event


def prepare_state(path):
    if not os.path.isabs(path):
        raise RelayError('state_dir_must_be_absolute')
    os.makedirs(path, mode=0o700, exist_ok=True)
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise RelayError('state_dir_not_regular_directory')
    if os.name == 'posix' and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise RelayError('state_dir_requires_owner_only_permissions')


@contextlib.contextmanager
def state_lock(path):
    flags = os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(os.path.join(path, 'relay.lock'), flags, 0o600)
    try:
        if os.name == 'posix':
            import fcntl
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            os.write(descriptor, b'0')
            os.lseek(descriptor, 0, os.SEEK_SET)
            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
    except (OSError, IOError):
        os.close(descriptor)
        raise RelayError('state_dir_already_in_use')
    try:
        yield
    finally:
        os.close(descriptor)


class Ledger:
    def __init__(self, state_dir, edge_id=DEFAULT_EDGE, recorded=False):
        prepare_state(state_dir)
        self.edge_id = identifier(edge_id)
        self.recorded = recorded
        path = os.path.join(state_dir, 'relay.sqlite3')
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        os.close(descriptor)
        self.db = sqlite3.connect(path, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS captures (
                hash TEXT PRIMARY KEY, content BLOB NOT NULL, mode TEXT NOT NULL,
                command_status TEXT NOT NULL, first_seen REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS records (
                key TEXT PRIMARY KEY, raw TEXT NOT NULL, event TEXT NOT NULL,
                capture_hash TEXT NOT NULL REFERENCES captures(hash),
                state TEXT NOT NULL DEFAULT 'pending');
            CREATE TABLE IF NOT EXISTS issues (
                capture_hash TEXT NOT NULL REFERENCES captures(hash),
                line INTEGER NOT NULL, reason TEXT NOT NULL, record_key TEXT,
                PRIMARY KEY(capture_hash,line,reason));
            CREATE TABLE IF NOT EXISTS batches (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                available_at REAL NOT NULL DEFAULT 0, last_error TEXT, ack TEXT);
            CREATE TABLE IF NOT EXISTS batch_items (
                batch_id TEXT NOT NULL REFERENCES batches(id),
                record_key TEXT NOT NULL UNIQUE REFERENCES records(key),
                PRIMARY KEY(batch_id,record_key));
        ''')
        try:
            self.bind('format', 'host-relay-v1')
            self.bind('edge_id', edge_id)
            self.bind('capture_mode', 'recorded' if recorded else 'poll')
        except Exception:
            self.db.close()
            raise

    def bind(self, key, value):
        with self.db:
            old = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
            if old and old['value'] != value:
                raise RelayError('ledger_configuration_mismatch')
            self.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)', (key, value))

    def close(self):
        self.db.close()

    def ingest(self, content, command_status='ok'):
        """Capture bytes + mapped events + rejected/conflicting lines commit together."""
        capture_hash = digest(content)
        counts = {'new': 0, 'duplicates': 0, 'issues': 0}
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO captures VALUES (?,?,?,?,?)',
                            (capture_hash, sqlite3.Binary(content),
                             'recorded' if self.recorded else 'poll', command_status, time.time()))
            for number, line in enumerate(content.splitlines(), 1):
                marker_at = line.find(MARKER)
                if marker_at >= 0:
                    candidate = line[marker_at + len(MARKER):]
                elif self.recorded and line.lstrip().startswith(b'{'):
                    candidate = line.strip()
                else:
                    continue
                key = None
                try:
                    record = strict_json(candidate.decode('utf-8'))
                    event = to_event(record, self.recorded)
                    key = canonical([event['run_id'], event['tester_id'], event['event_id']])
                    raw, outbound = canonical(record), canonical(event)
                except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError):
                    reason = 'invalid_or_unscoped_record'
                else:
                    old = self.db.execute('SELECT raw,event FROM records WHERE key=?', (key,)).fetchone()
                    if old and (old['raw'] != raw or old['event'] != outbound):
                        reason = 'identity_conflict'
                        self.db.execute(
                            "UPDATE records SET state='conflict' WHERE key=?", (key,))
                        self.db.execute(
                            "UPDATE batches SET state='blocked',last_error='identity_conflict' "
                            "WHERE state='pending' AND id IN "
                            '(SELECT batch_id FROM batch_items WHERE record_key=?)', (key,))
                    elif old:
                        counts['duplicates'] += 1
                        continue
                    else:
                        self.db.execute('INSERT INTO records(key,raw,event,capture_hash) VALUES (?,?,?,?)',
                                        (key, raw, outbound, capture_hash))
                        counts['new'] += 1
                        continue
                self.db.execute('INSERT OR IGNORE INTO issues VALUES (?,?,?,?)',
                                (capture_hash, number, reason, key))
                counts['issues'] += 1
        return counts

    def _batch(self, events):
        batch = {'schema_version': '1', 'edge_id': self.edge_id, 'events': events}
        batch['batch_id'] = digest(canonical(batch).encode('ascii'))
        return batch

    def stage(self, batch_size=25):
        """Freeze membership before HTTP; retries never silently re-batch."""
        if type(batch_size) is not int or not 1 <= batch_size <= 100:
            raise ValueError('invalid_batch_size')
        with self.db:
            rows = self.db.execute(
                "SELECT key,event FROM records WHERE state='pending' "
                'AND key NOT IN (SELECT record_key FROM batch_items) ORDER BY rowid LIMIT ?',
                (batch_size,)).fetchall()
            events, keys, ids = [], [], set()
            for row in rows:
                event = strict_json(row['event'])
                # ACKs contain bare event IDs: never put repeated IDs from
                # different tester/run scopes in the same batch.
                if event['event_id'] in ids:
                    break
                candidate = self._batch(events + [event])
                if len(canonical(candidate).encode('ascii')) > MAX_BODY:
                    if not events:
                        self.db.execute(
                            "UPDATE records SET state='oversized' WHERE key=?", (row['key'],))
                        continue
                    break
                events.append(event)
                keys.append(row['key'])
                ids.add(event['event_id'])
            if not events:
                return None
            batch = self._batch(events)
            self.db.execute('INSERT INTO batches(id,payload) VALUES (?,?)',
                            (batch['batch_id'], canonical(batch)))
            self.db.executemany('INSERT INTO batch_items VALUES (?,?)',
                                [(batch['batch_id'], key) for key in keys])
        return batch['batch_id']

    def send_one(self, transport, now=None, batch_size=25):
        now = time.time() if now is None else now
        row = self.db.execute(
            "SELECT * FROM batches WHERE state='pending' AND available_at<=? ORDER BY rowid LIMIT 1",
            (now,)).fetchone()
        if row is None:
            self.stage(batch_size)
            row = self.db.execute(
                "SELECT * FROM batches WHERE state='pending' AND available_at<=? ORDER BY rowid LIMIT 1",
                (now,)).fetchone()
        if row is None:
            return None
        batch = strict_json(row['payload'])
        try:
            ack = transport.post(batch)
            validate_ack(batch, ack)
        except Exception as exc:
            # Never retain/display exception messages from HTTP libraries.
            reason = exc.args[0] if isinstance(exc, RelayError) else 'transport_failure'
            if reason not in ('ack_mismatch', 'http_failure', 'redirect_refused', 'ack_too_large'):
                reason = 'transport_failure'
            attempts = row['attempts'] + 1
            delay = min(300, 5 * (2 ** min(attempts - 1, 6)))
            with self.db:
                self.db.execute('UPDATE batches SET attempts=?,available_at=?,last_error=? WHERE id=?',
                                (attempts, now + delay, reason, row['id']))
            return False
        with self.db:
            self.db.execute(
                "UPDATE batches SET state='delivered',ack=?,last_error=NULL WHERE id=?",
                (canonical(ack), row['id']))
            self.db.execute(
                "UPDATE records SET state='delivered' WHERE state='pending' AND key IN "
                '(SELECT record_key FROM batch_items WHERE batch_id=?)', (row['id'],))
        return True

    def status(self):
        records = dict(self.db.execute('SELECT state,count(*) FROM records GROUP BY state').fetchall())
        batches = dict(self.db.execute('SELECT state,count(*) FROM batches GROUP BY state').fetchall())
        return {'records': records, 'batches': batches,
                'issues': self.db.execute('SELECT count(*) FROM issues').fetchone()[0]}


def validate_ack(batch, ack):
    if (not isinstance(ack, dict) or ack.get('batch_id') != batch['batch_id']
            or ack.get('status') not in ('stored', 'duplicate')):
        raise RelayError('ack_mismatch')
    accepted, duplicates, rejected = (ack.get(name) for name in ('accepted', 'duplicates', 'rejected'))
    if not all(isinstance(value, list) for value in (accepted, duplicates, rejected)) or rejected:
        raise RelayError('ack_mismatch')
    if ack['status'] == 'duplicate' and accepted:
        raise RelayError('ack_mismatch')
    known = [event['event_id'] for event in batch['events']]
    supplied = accepted + duplicates
    if (not all(isinstance(item, str) for item in supplied)
            or len(supplied) != len(set(supplied))
            or len(known) != len(set(known)) or set(supplied) != set(known)):
        raise RelayError('ack_mismatch')


def load_config(path):
    # The intended runtime is the Linux HC. Fail closed where POSIX owner/mode
    # guarantees cannot be checked rather than treating Windows chmod as ACLs.
    if os.name != 'posix':
        raise RelayError('private_config_requires_posix_host')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'r', encoding='utf-8') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise RelayError('private_config_requires_mode_0600_and_current_owner')
        config = strict_json(stream.read(65537))
    if not isinstance(config, dict) or set(config) != {'endpoint', 'token', 'edge_id'}:
        raise RelayError('invalid_private_config')
    validate_destination(config)
    return config


def validate_destination(config):
    endpoint, token = config.get('endpoint'), config.get('token')
    if not isinstance(endpoint, str) or not isinstance(token, str):
        raise RelayError('invalid_private_config')
    parsed = urllib.parse.urlsplit(endpoint)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or parsed.path != '/api/v1/events/batch'
            or any(char.isspace() or ord(char) < 32 for char in endpoint)):
        raise RelayError('invalid_https_endpoint')
    if not token or any(ord(char) < 33 or ord(char) > 126 for char in token):
        raise RelayError('invalid_private_token')
    identifier(config.get('edge_id'))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Transport:
    def __init__(self, config, timeout=10):
        validate_destination(config)
        self.endpoint, self.token, self.timeout = config['endpoint'], config['token'], timeout
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    def post(self, batch):
        request = urllib.request.Request(
            self.endpoint, data=canonical(batch).encode('ascii'), method='POST',
            headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                     'Authorization': 'Bearer ' + self.token})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if not 200 <= response.getcode() < 300:
                    raise RelayError('http_failure')
                body = response.read(MAX_ACK + 1)
                if len(body) > MAX_ACK:
                    raise RelayError('ack_too_large')
                return strict_json(body.decode('utf-8'))
        except urllib.error.HTTPError as exc:
            code = exc.code
            exc.close()
            raise RelayError('redirect_refused' if 300 <= code < 400 else 'http_failure')


def poll(command, timeout):
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                timeout=timeout, check=False)
        return result.stdout, 'ok' if result.returncode == 0 else 'command_failed'
    except subprocess.TimeoutExpired as exc:
        # run() kills/waits for its direct child; keep complete records already
        # emitted, and quarantine the final partial JSON instead of stitching it.
        return exc.output or b'', 'command_timeout'
    except OSError:
        return b'', 'command_unavailable'


def positive(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError('must be finite and positive')
    return number


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', required=True, help='absolute persistent private host directory')
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--capture', help='saved EdgeLog/JSONL: always recorded/replay; one import')
    source.add_argument('--drain', action='store_true', help='retry ledger only; never poll the machine')
    parser.add_argument('--recorded-ledger', action='store_true', help='with --drain, open a recorded ledger')
    parser.add_argument('--send', action='store_true', help='enable HTTPS; requires private --config')
    parser.add_argument('--config', help='path to owner-only mode-0600 JSON')
    parser.add_argument('--edge-id', default=DEFAULT_EDGE, help='offline ledger identity; config must match')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--interval', type=positive, default=5)
    parser.add_argument('--command-timeout', type=positive, default=10)
    parser.add_argument('--http-timeout', type=positive, default=10)
    parser.add_argument('--batch-size', type=int, choices=range(1, 101), default=25)
    parser.add_argument('--max-batches', type=int, default=10, help='maximum HTTP attempts per cycle')
    parser.add_argument('--edgelog', default='/home/user/Case_Event/Edge/EdgeLog/EdgeLog',
                        help='host executable; invoked directly with argument log')
    args = parser.parse_args(argv)
    if args.send and not args.config:
        parser.error('--send requires --config')
    if args.config and not args.send:
        parser.error('--config requires --send')
    if args.recorded_ledger and not args.drain:
        parser.error('--recorded-ledger requires --drain')
    if not 1 <= args.max_batches <= 100:
        parser.error('--max-batches must be 1..100')
    os.umask(0o077)
    try:
        config = load_config(args.config) if args.send else None
        edge_id = config['edge_id'] if config else args.edge_id
        prepare_state(args.state_dir)
        with state_lock(args.state_dir):
            ledger = Ledger(args.state_dir, edge_id, bool(args.capture or args.recorded_ledger))
            try:
                transport = Transport(config, args.http_timeout) if config else None
                if config:
                    ledger.bind('destination_sha256', digest(config['endpoint'].encode('utf-8')))
                while True:
                    command_status = 'not_polled'
                    if args.capture:
                        with open(args.capture, 'rb') as stream:
                            content = stream.read()
                        command_status = 'recorded'
                        ledger.ingest(content, command_status)
                    elif not args.drain:
                        content, command_status = poll([args.edgelog, 'log'], args.command_timeout)
                        ledger.ingest(content, command_status)
                    if transport:
                        # Bound send work by both count and wall-clock budget so
                        # backend outages do not starve periodic EdgeLog capture.
                        deadline = time.monotonic() + args.interval
                        for unused in range(args.max_batches):
                            sent = ledger.send_one(transport, batch_size=args.batch_size)
                            if sent is None or sent is False or time.monotonic() >= deadline:
                                break
                    status = ledger.status()
                    status['command_status'] = command_status
                    print(canonical(status), flush=True)
                    if args.once or args.capture:
                        problem = (status['issues'] or any(state != 'delivered' and count
                                   for state, count in status['records'].items()) if args.send
                                   else status['issues'])
                        return 1 if problem or command_status in (
                            'command_failed', 'command_timeout', 'command_unavailable') else 0
                    time.sleep(args.interval)
            finally:
                ledger.close()
    except KeyboardInterrupt:
        return 130
    except Exception:
        # Paths, raw records, endpoint/token and arbitrary library errors never
        # enter the console. Inspect the private ledger for retained evidence.
        print('host_relay: local_configuration_or_storage_failure', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
