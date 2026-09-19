"""Offline relay contract/recovery tests. No machine or public network calls."""
import ast
import copy
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

from deploy import host_relay as relay


def record(event_id='event-1', **updates):
    value = {
        'schema_version': 1, 'event_id': event_id, 'run_id': 'run-original',
        'tester': 'tester-original', 'kind': 'prediction_request', 'sequence': 12,
        'source_mode': 'live', 'time': 1609459200.125,
        'timestamp': '2021-01-01T00:00:00.125000+00:00', 'lot': 'lot-original',
        'wafer': 3, 'request_id': 'request-original', 'stage': 2,
        'prediction_ids': {'1': 'prediction-original'},
        'device_ids': {'1': 'device-original'}, 'predictions': {'1': 12.5},
        'coverage': {'1': 0.75}, 'status': 'response_queued', 'unit': None,
    }
    value.update(updates)
    return value


def capture(*values):
    return b''.join(b'Edge prefix: GRP6_EVIDENCE ' + json.dumps(value).encode('utf-8') + b'\n'
                    for value in values)


def ack(batch, duplicate=False):
    ids = [event['event_id'] for event in batch['events']]
    return {'batch_id': batch['batch_id'], 'accepted': [] if duplicate else ids,
            'duplicates': ids if duplicate else [], 'rejected': [],
            'status': 'duplicate' if duplicate else 'stored'}


class TransportStub:
    def __init__(self, handler=ack):
        self.handler = handler
        self.calls = []

    def post(self, batch):
        self.calls.append(copy.deepcopy(batch))
        return self.handler(batch)


class MappingTests(unittest.TestCase):
    def test_scope_time_and_all_prediction_fields_preserved(self):
        raw = record()
        event = relay.to_event(raw)
        self.assertEqual(event['raw_record'], raw)
        self.assertEqual(event['timestamp'], 1609459200.125)
        self.assertEqual(event['tester_id'], raw['tester'])
        self.assertEqual(event['wafer_id'], '3')
        self.assertEqual(event['mode'], 'live')
        for field in ('event_id', 'run_id', 'request_id', 'prediction_ids', 'device_ids',
                      'predictions', 'coverage', 'status', 'sequence', 'time'):
            self.assertEqual(event[field], raw[field])
        self.assertEqual(event['host_relay']['freshness'], 'source_time_only')
        self.assertNotIn('tester_receipt_id', event)
        self.assertNotIn('measurements', event)

    def test_recorded_live_is_replay_with_original_provenance(self):
        raw = record()
        event = relay.to_event(raw, recorded=True)
        self.assertEqual(event['mode'], 'replay')
        self.assertEqual(event['source_mode'], 'replay')
        self.assertEqual(event['raw_record']['source_mode'], 'live')
        self.assertEqual(event['host_relay']['capture_mode'], 'recorded')
        self.assertEqual(event['timestamp'], raw['time'])
        self.assertEqual(raw['source_mode'], 'live')

    def test_missing_actual_stays_missing_and_actions_stay_unconfirmed(self):
        raw = record(kind='prediction_actual', prediction_id='prediction-original',
                     device_id='device-original', site='1', actual=None, predicted=12.5)
        event = relay.to_event(raw)
        self.assertIsNone(event['actual'])
        self.assertEqual(event['prediction_id'], raw['prediction_id'])
        action = relay.to_event(record(kind='action_message', status='queued_unconfirmed'))
        self.assertEqual(action['status'], 'queued_unconfirmed')
        self.assertNotIn('tester_receipt_id', action)

    def test_timezone_qualified_iso_fallback_is_source_time(self):
        raw = record(timestamp='2021-01-01T08:00:00.125000+08:00')
        del raw['time']
        self.assertEqual(relay.to_event(raw)['timestamp'], 1609459200.125)
        raw['timestamp'] = '2021-01-01T00:00:00.125Z'
        self.assertEqual(relay.to_event(raw)['timestamp'], 1609459200.125)

    def test_real_monitor_timestamp_preserves_original_submicrosecond_epoch(self):
        # Original retained engineering Monitor timestamp, rounded to six
        # ISO fractional digits by Monitor.log; Unix time remains authoritative.
        raw = record(time=1789799476.5290916,
                     timestamp='2026-09-19T06:31:16.529092+00:00')
        self.assertEqual(relay.to_event(raw)['timestamp'], 1789799476.5290916)
        self.assertEqual(relay.to_event(raw)['raw_record']['timestamp'], raw['timestamp'])

    def test_bad_or_ambiguous_source_fields_fail_closed(self):
        changes = [dict(tester=''), dict(run_id=None), dict(sequence=True),
                   dict(source_mode='unknown'), dict(schema_version='1'),
                   dict(timestamp='2021-01-01T00:00:00'), dict(time=1609459201),
                   dict(time=float('inf')), dict(timestamp='2021-01-01T00:00:00+08:99'),
                   dict(lot={}), dict(event_id='x' * 121)]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                relay.to_event(record(**change))

    def test_source_replay_and_simulation_not_upgraded_by_poll(self):
        for mode in ('replay', 'simulation'):
            self.assertEqual(relay.to_event(record(source_mode=mode))['mode'], mode)


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = self.temp.name
        self.ledger = relay.Ledger(self.path)

    def tearDown(self):
        self.ledger.close()
        self.temp.cleanup()

    def restart(self):
        self.ledger.close()
        self.ledger = relay.Ledger(self.path)

    def test_overlapping_polls_and_delivered_duplicates_after_restart(self):
        self.ledger.ingest(capture(record('a'), record('b')))
        counts = self.ledger.ingest(capture(record('b'), record('c')))
        self.assertEqual(counts, {'new': 1, 'duplicates': 1, 'issues': 0})
        transport = TransportStub()
        self.assertTrue(self.ledger.send_one(transport))
        self.restart()
        counts = self.ledger.ingest(capture(record('a'), record('b'), record('c')))
        self.assertEqual(counts['duplicates'], 3)
        self.assertIsNone(self.ledger.send_one(transport))
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(self.ledger.status()['records'], {'delivered': 3})

    def test_stable_membership_lost_ack_retry_and_restart(self):
        self.ledger.ingest(capture(record('a'), record('b')))
        failing = TransportStub(lambda batch: (_ for _ in ()).throw(OSError('secret endpoint')))
        self.assertFalse(self.ledger.send_one(failing, now=100))
        self.restart()
        self.ledger.ingest(capture(record('c')))
        succeeding = TransportStub(lambda batch: ack(batch, duplicate=True))
        self.assertTrue(self.ledger.send_one(succeeding, now=105))
        self.assertEqual(failing.calls[0], succeeding.calls[0])
        self.assertTrue(self.ledger.send_one(succeeding, now=105))
        self.assertNotEqual(succeeding.calls[0]['batch_id'], succeeding.calls[1]['batch_id'])
        self.assertEqual(self.ledger.status()['records'], {'delivered': 3})

    def test_partial_and_malformed_ack_never_delivers_any_member(self):
        self.ledger.ingest(capture(record('a'), record('b')))
        corruptions = [
            lambda a: a.pop('status'),
            lambda a: a.update(status='queued'),
            lambda a: a.update(status='duplicate'),
            lambda a: a.update(batch_id='wrong'),
            lambda a: a.update(accepted=['a']),
            lambda a: a.update(accepted=['a', 'b', 'unknown']),
            lambda a: a.update(accepted=['a', 'a', 'b']),
            lambda a: a.update(duplicates=['a']),
            lambda a: a.update(rejected=['b']),
            lambda a: a.pop('rejected'),
            lambda a: a.update(accepted=[{'event_id': 'a'}, 'b']),
        ]
        original = None
        for index, corrupt in enumerate(corruptions):
            def handler(batch):
                value = ack(batch)
                corrupt(value)
                return value
            transport = TransportStub(handler)
            self.assertFalse(self.ledger.send_one(transport, now=1000 * index))
            original = original or transport.calls[0]
            self.assertEqual(transport.calls[0], original)
            self.assertEqual(self.ledger.status()['records'], {'pending': 2})
        final = TransportStub(lambda b: {'batch_id': b['batch_id'], 'accepted': ['a'],
                                         'duplicates': ['b'], 'rejected': [], 'status': 'stored'})
        self.assertTrue(self.ledger.send_one(final, now=20000))

    def test_committed_raw_and_frozen_batch_exist_before_network(self):
        original = capture(record())
        self.ledger.ingest(original)
        def verify(batch):
            other = sqlite3.connect(os.path.join(self.path, 'relay.sqlite3'))
            try:
                self.assertEqual(other.execute('SELECT content FROM captures').fetchone()[0], original)
                event = json.loads(other.execute('SELECT event FROM records').fetchone()[0])
                self.assertEqual(event, batch['events'][0])
                self.assertEqual(other.execute('SELECT id FROM batches').fetchone()[0], batch['batch_id'])
            finally:
                other.close()
            return ack(batch)
        self.assertTrue(self.ledger.send_one(TransportStub(verify)))

    def test_storage_failure_rolls_back_capture_and_records_together(self):
        self.ledger.db.execute(
            "CREATE TRIGGER fail_record BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'disk'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.ledger.ingest(capture(record()))
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM captures').fetchone()[0], 0)
        self.assertEqual(self.ledger.status()['records'], {})

    def test_conflict_preserves_both_captures_and_blocks_frozen_batch(self):
        original = capture(record('a'), record('b'))
        changed = capture(record('a', predictions={'1': 999}))
        self.ledger.ingest(original)
        self.ledger.stage()
        counts = self.ledger.ingest(changed)
        self.assertEqual(counts['issues'], 1)
        self.assertEqual(self.ledger.status()['batches'], {'blocked': 1})
        self.assertEqual(self.ledger.status()['records'], {'conflict': 1, 'pending': 1})
        self.assertIsNone(self.ledger.send_one(TransportStub()))
        saved = self.ledger.db.execute('SELECT content FROM captures').fetchall()
        self.assertEqual({row[0] for row in saved}, {original, changed})
        event = json.loads(self.ledger.db.execute('SELECT event FROM records ORDER BY rowid').fetchone()[0])
        self.assertEqual(event['predictions'], {'1': 12.5})

    def test_same_event_id_different_scopes_dedup_and_ack_separately(self):
        records = [record(), record(run_id='another-run'), record(tester='another-tester')]
        self.ledger.ingest(capture(*records))
        transport = TransportStub()
        for unused in range(3):
            self.assertTrue(self.ledger.send_one(transport))
        self.assertEqual([len(b['events']) for b in transport.calls], [1, 1, 1])
        self.assertEqual(len({b['batch_id'] for b in transport.calls}), 3)

    def test_malformed_partial_unscoped_and_nonfinite_records_are_retained(self):
        content = (b'ordinary non-JSON log\n' + capture(record('good')) +
                   b'GRP6_EVIDENCE {"event_id":"partial"\n' +
                   b'GRP6_EVIDENCE {"x":1,"x":2}\n' +
                   b'GRP6_EVIDENCE {"x":NaN}\n' +
                   b'GRP6_EVIDENCE {"x":1e999}\n' +
                   b'GRP6_EVIDENCE \xff\n' + capture(record('unscoped', tester='')))
        counts = self.ledger.ingest(content, 'command_timeout')
        self.assertEqual(counts, {'new': 1, 'duplicates': 0, 'issues': 6})
        self.assertEqual(self.ledger.db.execute('SELECT content FROM captures').fetchone()[0], content)
        self.assertTrue(self.ledger.send_one(TransportStub()))
        self.assertEqual(self.ledger.status()['records'], {'delivered': 1})

    def test_whitespace_and_log_prefix_do_not_change_identity(self):
        self.ledger.ingest(capture(record()))
        alternate = b'changed prefix GRP6_EVIDENCE ' + relay.canonical(record()).encode('ascii')
        self.assertEqual(self.ledger.ingest(alternate)['duplicates'], 1)

    def test_capture_and_destination_binding_cannot_silently_change(self):
        with self.assertRaises(relay.RelayError):
            relay.Ledger(self.path, recorded=True)
        with self.assertRaises(relay.RelayError):
            relay.Ledger(self.path, edge_id='new-edge')
        self.ledger.bind('destination_sha256', 'one')
        with self.assertRaises(relay.RelayError):
            self.ledger.bind('destination_sha256', 'two')

    def test_backoff_persists_is_bounded_and_does_not_leak_exceptions(self):
        self.ledger.ingest(capture(record()))
        transport = TransportStub(lambda batch: (_ for _ in ()).throw(OSError('SECRET')))
        now = 100
        for unused in range(12):
            self.assertFalse(self.ledger.send_one(transport, now=now))
            row = self.ledger.db.execute('SELECT * FROM batches').fetchone()
            self.assertGreater(row['available_at'], now)
            self.assertLessEqual(row['available_at'] - now, 300)
            self.assertEqual(row['last_error'], 'transport_failure')
            self.assertIsNone(self.ledger.send_one(transport, now=now))
            self.restart()
            now = row['available_at']
        self.assertEqual(len(transport.calls), 12)

    def test_oversized_records_retained_and_do_not_block_smaller_records(self):
        self.ledger.ingest(capture(record('huge', detail='x' * 3000), record('small')))
        with mock.patch.object(relay, 'MAX_BODY', 2500):
            self.assertTrue(self.ledger.send_one(TransportStub()))
        self.assertEqual(self.ledger.status()['records'], {'delivered': 1, 'oversized': 1})


class IOTests(unittest.TestCase):
    def test_real_child_timeout_preserves_complete_and_partial_bytes(self):
        program = 'import sys,time; sys.stdout.write("GRP6_EVIDENCE {partial\\n"); sys.stdout.flush(); time.sleep(10)'
        content, status = relay.poll([sys.executable, '-c', program], 0.5)
        self.assertEqual(status, 'command_timeout')
        self.assertIn(b'GRP6_EVIDENCE {partial', content)

    def test_command_is_direct_with_timeout_and_nonzero_output_preserved(self):
        completed = subprocess.CompletedProcess(['edgelog', 'log'], 2, stdout=capture(record()))
        with mock.patch.object(relay.subprocess, 'run', return_value=completed) as run:
            content, status = relay.poll(['edgelog', 'log'], 7)
        self.assertEqual(content, completed.stdout)
        self.assertEqual(status, 'command_failed')
        self.assertEqual(run.call_args[0][0], ['edgelog', 'log'])
        self.assertEqual(run.call_args[1]['timeout'], 7)
        self.assertNotIn('shell', run.call_args[1])

    def test_destination_rejects_http_credentials_queries_fragments_and_wrong_route(self):
        for endpoint in ('http://example.org/api/v1/events/batch',
                         'https://user:pass@example.org/api/v1/events/batch',
                         'https://example.org/api/v1/events/batch?token=secret',
                         'https://example.org/api/v1/events/batch#frag',
                         'https://example.org/other'):
            with self.subTest(endpoint=endpoint), self.assertRaises(relay.RelayError):
                relay.validate_destination({'endpoint': endpoint, 'token': 'placeholder', 'edge_id': 'hc'})

    def test_redirect_and_http_failures_never_ack(self):
        transport = relay.Transport({'endpoint': 'https://example.org/api/v1/events/batch',
                                     'token': 'placeholder', 'edge_id': 'hc'})
        for code in (301, 302, 307, 308, 400, 401, 403, 409, 422, 429, 500):
            error = urllib.error.HTTPError(transport.endpoint, code, 'secret', {}, io.BytesIO(b'secret'))
            with mock.patch.object(transport.opener, 'open', side_effect=error):
                with self.assertRaises(relay.RelayError) as caught:
                    transport.post({'events': []})
                self.assertNotIn('secret', str(caught.exception))
        handler = relay.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, '', {}, 'https://other.example'))
        self.assertTrue(any(isinstance(h, relay.NoRedirect) for h in transport.opener.handlers))

    def test_ack_size_and_json_validation_and_request_headers(self):
        transport = relay.Transport({'endpoint': 'https://example.org/api/v1/events/batch',
                                     'token': 'placeholder', 'edge_id': 'hc'}, timeout=9)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.getcode.return_value = 200
        response.read.return_value = b'x' * (relay.MAX_ACK + 1)
        with mock.patch.object(transport.opener, 'open', return_value=response) as opened:
            with self.assertRaises(relay.RelayError):
                transport.post({'events': []})
            self.assertEqual(opened.call_args[1]['timeout'], 9)
            self.assertEqual(opened.call_args[0][0].get_header('Authorization'), 'Bearer placeholder')
            response.read.assert_called_once_with(relay.MAX_ACK + 1)
        response.read.return_value = b'{"accepted":[],"accepted":[]}'
        with mock.patch.object(transport.opener, 'open', return_value=response), self.assertRaises(ValueError):
            transport.post({'events': []})

    @unittest.skipUnless(os.name == 'posix', 'mode-0600 security requires POSIX host')
    def test_private_configuration_and_symlink_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'private.json')
            config = {'endpoint': 'https://example.org/api/v1/events/batch',
                      'token': 'placeholder', 'edge_id': 'hc'}
            with open(path, 'w') as stream:
                json.dump(config, stream)
            os.chmod(path, 0o600)
            self.assertEqual(relay.load_config(path), config)
            os.chmod(path, 0o644)
            with self.assertRaises(relay.RelayError):
                relay.load_config(path)
            os.chmod(path, 0o600)
            link = os.path.join(directory, 'link')
            os.symlink(path, link)
            with self.assertRaises(OSError):
                relay.load_config(link)

    def test_cli_capture_is_offline_replay_and_restart_is_deduplicated(self):
        with tempfile.TemporaryDirectory() as directory:
            source = os.path.join(directory, 'capture.log')
            state = os.path.join(directory, 'state')
            with open(source, 'wb') as stream:
                stream.write(json.dumps(record()).encode('utf-8'))
            with mock.patch.object(relay, 'Transport') as network, mock.patch('sys.stdout', new_callable=io.StringIO):
                for unused in range(2):
                    self.assertEqual(relay.main(['--state-dir', state, '--capture', source]), 0)
                network.assert_not_called()
            ledger = relay.Ledger(state, recorded=True)
            try:
                self.assertEqual(ledger.status()['records'], {'pending': 1})
                event = json.loads(ledger.db.execute('SELECT event FROM records').fetchone()[0])
                self.assertEqual(event['mode'], 'replay')
            finally:
                ledger.close()

    def test_exclusive_state_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            with relay.state_lock(directory):
                with self.assertRaises(relay.RelayError):
                    with relay.state_lock(directory):
                        self.fail('second lock must not succeed')

    def test_python36_syntax(self):
        if sys.version_info < (3, 8):
            self.skipTest('feature_version parser unavailable; runtime itself checks syntax')
        with open(relay.__file__, encoding='utf-8') as stream:
            ast.parse(stream.read(), feature_version=(3, 6))


if __name__ == '__main__':
    unittest.main()
