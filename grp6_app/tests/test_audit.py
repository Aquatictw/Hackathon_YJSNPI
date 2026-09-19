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
