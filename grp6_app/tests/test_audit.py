import json
import tempfile
import unittest
from pathlib import Path
from deploy.audit_evidence import audit


class EvidenceAuditTests(unittest.TestCase):
    def complete(self):
        records = [dict(kind=k) for k in ('monitor_start', 'lot_start', 'measurement', 'test_start')]
        for stage in range(1, 7):
            records.append(dict(kind='prediction_request', stage=stage,
                coverage={'1': 1.0}, predictions={'1': 2.0},
                response='tester action', status='response_queued', latency_ms=1))
            records.append(dict(kind='prediction_actual', stage=stage))
        records += [dict(kind='device_end'), dict(kind='boundary_end')]
        return [dict(e, sequence=i, source_mode='live') for i, e in enumerate(records, 1)]

    def check_records(self, records, devices=1, touchdowns=1):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'evidence.jsonl'
            path.write_text('\n'.join(json.dumps(e) for e in records), encoding='utf-8')
            return audit(path, devices, touchdowns)

    def test_complete_capture_is_not_tester_receipt(self):
        result = self.check_records(self.complete())
        self.assertTrue(result['complete_production_capture'])
        self.assertIn('UNVERIFIED', result['tester_receipt'])
        self.assertEqual(result['production_action_json'],
                         {'checked': 0, 'invalid': 0, 'errors': []})

    def test_valid_production_json_does_not_prove_receipt(self):
        records = self.complete()
        responses = [' { "mtesterAction": [] }\n', json.dumps({
            'reason': 'line one\nline two\t"quoted" \\ path 溫度'})]
        for response in responses:
            records.append(dict(kind='production_action_response', sequence=len(records)+1,
                response=response, raw_response='{"reason":"literal\nLF"}',
                status='returned_to_callback_unconfirmed'))
        result = self.check_records(records)
        self.assertTrue(result['recorded_callback_gate'])
        self.assertTrue(result['complete_production_capture'])
        self.assertEqual(result['production_action_json'],
                         {'checked': 2, 'invalid': 0, 'errors': []})
        self.assertIn('UNVERIFIED', result['tester_receipt'])
        self.assertIn('INCOMPLETE', result['live_acceptance'])

    def test_invalid_production_json_blocks_both_gates(self):
        invalid = [None, {}, [], 1, True, '', '{', '{} trailing',
                   '{"reason":"bad\\q"}', '{"value":NaN}',
                   '{"value":Infinity}', '{"value":-Infinity}']
        invalid += ['{"reason":"before' + chr(n) + 'after"}' for n in range(32)]
        for response in invalid:
            with self.subTest(response=response):
                records = self.complete()
                records.append(dict(kind='production_action_response',
                    sequence=len(records)+1, event_id='bad-action', response=response))
                result = self.check_records(records)
                self.assertFalse(result['recorded_callback_gate'])
                self.assertFalse(result['complete_production_capture'])
                self.assertTrue(result['capture_integrity']['single_process_sequence_complete'])
                self.assertTrue(result['capture_integrity']['expected_counts_match'])
                self.assertEqual(result['errors'], 0)  # No recorded runtime errors.
                self.assertEqual(result['malformed_lines'], 0)  # Outer JSONL is valid.
                validation = result['production_action_json']
                self.assertEqual((validation['checked'], validation['invalid']), (1, 1))
                detail, = validation['errors']
                self.assertEqual(detail['sequence'], len(records))
                self.assertEqual(detail['line'], len(records))
                self.assertEqual(detail['event_id'], 'bad-action')
                self.assertTrue(detail['error'])
                self.assertIn('UNVERIFIED', result['tester_receipt'])

    def test_missing_response_and_multiple_errors_retain_event_locations(self):
        records = self.complete()
        records.append(dict(kind='production_action_response', sequence=len(records)+1))
        records.append(dict(kind='production_action_response', sequence=len(records)+1,
                            response='{"reason":"one\ntwo"}'))
        # A malformed outer line must not shift the reported physical line numbers.
        result = self.check_records([None] + records)
        validation = result['production_action_json']
        self.assertEqual((validation['checked'], validation['invalid']), (2, 2))
        missing, control = validation['errors']
        self.assertIn('response must be a JSON string', missing['error'])
        self.assertEqual(missing['sequence'], len(records)-1)
        self.assertEqual(missing['line'], len(records))
        self.assertEqual(control['sequence'], len(records))
        self.assertEqual(control['line'], len(records)+1)
        self.assertEqual(control['response_line'], 1)
        self.assertEqual(control['response_column'], 15)
        self.assertEqual(control['response_position'], 14)
        self.assertIn('Invalid control character', control['error'])

    def test_historical_production_sequence_319_is_rejected(self):
        path = Path(__file__).resolve().parents[2] / (
            'results/vm_production/grp6_core_prod3_evidence.jsonl')
        if not path.is_file():
            self.skipTest('Historical capture is not included in this checkout/bundle')
        result = audit(path, expected_devices=80, expected_touchdowns=20)
        self.assertEqual(result['production_action_json']['checked'], 20)
        self.assertEqual(result['production_action_json']['invalid'], 1)
        detail, = result['production_action_json']['errors']
        self.assertEqual(detail['sequence'], 319)
        self.assertEqual(detail['response_column'], 256)
        self.assertEqual(detail['response_position'], 255)
        self.assertIn('Invalid control character', detail['error'])
        self.assertTrue(result['capture_integrity']['single_process_sequence_complete'])
        self.assertTrue(result['capture_integrity']['expected_counts_match'])
        self.assertFalse(result['recorded_callback_gate'])
        self.assertFalse(result['complete_production_capture'])
        self.assertIn('UNVERIFIED', result['tester_receipt'])

    def test_legacy_engineering_capture_keeps_callback_acceptance(self):
        path = Path(__file__).resolve().parents[2] / (
            'results/vm_engineering/grp6_core_eng_evidence.jsonl')
        if not path.is_file():
            self.skipTest('Historical capture is not included in this checkout/bundle')
        result = audit(path, expected_devices=4, expected_touchdowns=1)
        self.assertTrue(result['recorded_callback_gate'])
        self.assertTrue(result['capture_integrity']['expected_counts_match'])
        self.assertEqual(result['production_action_json']['invalid'], 0)
        self.assertEqual(result['errors'], 0)
        self.assertIn('UNVERIFIED', result['tester_receipt'])

    def test_missing_sequence_blocks_acceptance(self):
        records = self.complete()
        del records[2]
        result = self.check_records(records)
        self.assertEqual(result['capture_integrity']['missing_sequence_ranges'], [[3, 3]])
        self.assertFalse(result['recorded_callback_gate'])

    def test_duplicate_and_restarted_process_block_acceptance(self):
        for extra in (self.complete()[2], self.complete()[0]):
            result = self.check_records(self.complete() + [extra])
            self.assertFalse(result['complete_production_capture'])
            self.assertFalse(result['capture_integrity']['single_process_sequence_complete'])

    def test_short_run_cannot_pass_expected_counts(self):
        result = self.check_records(self.complete(), devices=80, touchdowns=20)
        self.assertTrue(result['recorded_callback_gate'])
        self.assertFalse(result['complete_production_capture'])

    def test_replay_and_callback_errors_block_acceptance(self):
        for field in ('mode', 'source_mode'):
            records = self.complete()
            records[0][field] = 'replay'
            self.assertFalse(self.check_records(records)['recorded_callback_gate'])
        records = self.complete()
        records.append(dict(kind='callback_error', sequence=len(records)+1))
        self.assertFalse(self.check_records(records)['recorded_callback_gate'])
