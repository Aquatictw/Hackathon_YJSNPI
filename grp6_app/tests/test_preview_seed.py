import csv
import json
import tempfile
import unittest
from pathlib import Path

from grp6_app.data import TARGETS
from grp6_app.preview_seed import generate


class PreviewSeedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'sample.csv'
        self.feature = '1_Main.input#A'
        model = dict(features=[self.feature], intercept=1, mean=[0], scale=[1], coef=[2])
        (self.root / 'runtime.json').write_text(json.dumps(dict(columns=[self.feature], models={str(s): model for s in range(1, 7)})))
        (self.root / 'manifest.json').write_text(json.dumps(dict(stages={str(s): [self.feature] for s in range(1, 7)})))
        self.write_csv()

    def write_csv(self, feature='3', actual='8'):
        with self.source.open('w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            writer.writerow(['PID', 'Lot', 'Wafer', 'Site', 'X', 'Y', 'PF', 'SBin', 'HBin', 'Test Time', self.feature, *TARGETS.values()])
            writer.writerows([[]]*4)
            for index, site in enumerate([1, 1, 2, 3, 4, 5]):
                writer.writerow([index+1, 'lot', 7, site, 0, 0, '0x0', 1, 1, 1, feature, *([actual]*6)])

    def test_bounded_deterministic_scoped_joins_without_receipts(self):
        events, provenance = generate(self.source, self.root)
        self.assertEqual((events, provenance), generate(self.source, self.root))
        self.assertEqual(len(events), 52)
        self.assertEqual(provenance['sites'], ['1', '2', '3', '4'])
        self.assertEqual(len({event['event_id'] for event in events}), 52)
        for request, actual in zip(events[0:12:2], events[1:12:2]):
            self.assertEqual(request['predictions']['1'], 7)
            self.assertEqual(request['prediction_ids']['1'], actual['prediction_id'])
            self.assertEqual(request['device_ids']['1'], actual['device_id'])
            self.assertEqual(actual['absolute_error'], 1)
        for event in events:
            self.assertEqual(event['mode'], 'replay')
            self.assertNotIn('tester_receipt_id', event)
            self.assertNotEqual(event.get('status'), 'response_queued')

    def test_targets_cannot_influence_predictions_and_changes_get_new_ids(self):
        before, _ = generate(self.source, self.root)
        self.write_csv(actual='900')
        after, _ = generate(self.source, self.root)
        self.assertEqual(before[0]['predictions'], after[0]['predictions'])
        self.assertNotEqual(before[0]['event_id'], after[0]['event_id'])
        self.assertEqual(after[1]['actual'], 900)

    def test_missing_nonfinite_inputs_never_become_current_predictions(self):
        self.write_csv(feature='nan', actual='inf')
        events, _ = generate(self.source, self.root)
        self.assertEqual(events[0]['predictions'], {})
        self.assertEqual(events[0]['coverage'], {'1': 0})
        self.assertEqual(events[0]['status'], 'insufficient_current_data')
        self.assertIsNone(events[1]['actual'])
        self.assertEqual(events[12]['measurements'], [])

    def test_ineligible_selected_feature_fails_before_generation(self):
        (self.root / 'manifest.json').write_text(json.dumps(dict(stages={str(s): [] for s in range(1, 7)})))
        with self.assertRaisesRegex(ValueError, 'causal'):
            generate(self.source, self.root)
