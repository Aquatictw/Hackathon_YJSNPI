"""R3 structural/causal safety and synthetic behavioral regression tests."""
import copy
import math
from pathlib import Path
import unittest

from workstreams.detection.pooled_candidate import CONFIG, PooledSpreadDecrease
from workstreams.detection.synthetic_round3 import calibration, run_stream, stream
from workstreams.detection.evaluate_round3 import OWNED, output_path


class PooledCandidateTests(unittest.TestCase):
    def test_stable_increase_offsets_and_constants_abstain(self):
        for mode in ('stable', 'increase', 'site_offsets', 'constant'):
            with self.subTest(mode=mode):
                self.assertEqual(run_stream(stream(mode))[1], [])

    def test_persistent_real_decrease_and_localized_decrease(self):
        for mode in ('decrease', 'localized'):
            with self.subTest(mode=mode):
                detector, alerts, scans = run_stream(stream(mode))
                self.assertEqual(len(alerts), 1)
                self.assertEqual(alerts[0]['kind'], 'spread_down')
                self.assertGreater(alerts[0]['completed_devices'], 40)
                self.assertGreaterEqual(alerts[0]['persistence_scans'], 2)
                self.assertGreaterEqual(alerts[0]['hits'], 3)
                self.assertEqual(detector.analyze(final=True), [])

    def test_location_step_is_documented_specificity_failure(self):
        # Characterization, NOT a promotion-pass assertion: true variance stays
        # one, but a mean step inside the early half inflates temporal SD.
        self.assertTrue(run_stream(stream('location_step'))[1])

    def test_one_or_two_changed_tests_cannot_trigger(self):
        for mode in ('isolated_one', 'isolated_two'):
            self.assertEqual(run_stream(stream(mode))[1], [])

    def test_missing_nonfinite_and_numeric_overflow_fail_closed(self):
        for mode in ('missing', 'nonfinite', 'overflow'):
            detector, alerts, scans = run_stream(stream(mode))
            self.assertEqual(alerts, [])
            self.assertTrue(all(math.isfinite(s['statistic']) for s in scans))

    def test_missing_measurement_keeps_its_position(self):
        detector = PooledSpreadDecrease(calibration())
        name = next(iter(detector.baseline_sd))
        for value in (1, None, 2, True, 'bad', float('inf')):
            detector.add('1', {name: value})
        self.assertEqual(list(detector.windows['1'][name]), [1., None, 2., None, None, None])
        self.assertEqual(list(detector.orders['1']), [1, 2, 3, 4, 5, 6])

    def test_missing_site_and_unknown_site_never_signal(self):
        rows = list(stream('decrease'))
        self.assertEqual(run_stream((s, v) for s, v in rows if s != '4')[1], [])
        rows[0] = ('unexpected', rows[0][1])
        detector, alerts, _ = run_stream(rows)
        self.assertTrue(detector.invalid_scope)
        self.assertEqual(alerts, [])

    def test_stale_site_resets_persistence(self):
        detector, _, _ = run_stream(list(stream('decrease'))[:64])
        detector.streak['Synthetic.family'] = 1
        row = list(stream('decrease'))[64]
        for _ in range(8):
            detector.add(*row)
            self.assertEqual(detector.analyze(), [])
        self.assertEqual(detector.streak['Synthetic.family'], 0)

    def test_final_cannot_add_off_cadence_or_repeated_vote(self):
        detector, _, _ = run_stream(list(stream('decrease'))[:71])
        before = copy.deepcopy(detector.streak)
        self.assertEqual(detector.analyze(final=True), [])
        self.assertEqual(detector.streak, before)
        self.assertEqual(detector.last_analyzed, 64)

    def test_future_suffix_cannot_change_prefix(self):
        rows = list(stream('decrease'))
        prefix_detector, prefix_alerts, prefix_scans = run_stream(rows[:64])
        full_detector, full_alerts, full_scans = run_stream(rows)
        self.assertEqual(prefix_scans, [s for s in full_scans if s['completed_devices'] <= 64])
        self.assertEqual(prefix_alerts, [a for a in full_alerts if a['completed_devices'] <= 64])
        changed_suffix = rows[:64] + list(stream('increase'))[64:]
        _, _, changed_scans = run_stream(changed_suffix)
        self.assertEqual(prefix_scans, [s for s in changed_scans if s['completed_devices'] <= 64])

    def test_site_rename_and_interleaving_invariance(self):
        rows = list(stream('decrease'))
        _, base_alerts, base_scans = run_stream(rows)
        config = calibration()
        config['sites'] = ['socketA', 'socketB', 'socketC', 'socketD']
        renamed = [(config['sites'][int(s)-1], v) for s, v in rows]
        _, renamed_alerts, renamed_scans = run_stream(renamed, config)
        self.assertEqual([s['statistic'] for s in base_scans], [s['statistic'] for s in renamed_scans])
        shuffled = [row for i in range(0, len(rows), 4) for row in reversed(rows[i:i+4])]
        _, shuffled_alerts, shuffled_scans = run_stream(shuffled)
        self.assertEqual([s['statistic'] for s in base_scans], [s['statistic'] for s in shuffled_scans])
        self.assertEqual([a['completed_devices'] for a in base_alerts], [a['completed_devices'] for a in renamed_alerts])
        self.assertEqual([a['completed_devices'] for a in base_alerts], [a['completed_devices'] for a in shuffled_alerts])

    def test_constant_site_offsets_do_not_change_statistic(self):
        _, _, base = run_stream(stream('stable'))
        _, _, offset = run_stream(stream('site_offsets'))
        for a, b in zip(base, offset):
            self.assertAlmostEqual(a['statistic'], b['statistic'], places=11)

    def test_state_bounded_on_long_stream_and_instance_reset(self):
        detector, _, _ = run_stream(stream(devices=800))
        bound = detector.state_bound()
        self.assertEqual(bound['retained_measurement_slots'], 100 * 4 * 20)
        self.assertEqual(bound['maximum_measurement_slots'], bound['retained_measurement_slots'])
        self.assertTrue(all(len(o) == 20 for o in detector.orders.values()))
        fresh = PooledSpreadDecrease(calibration())
        self.assertEqual(fresh.completed, 0)
        self.assertFalse(fresh.emitted)
        self.assertEqual(fresh.state_bound()['retained_measurement_slots'], 0)

    def test_configuration_validation(self):
        bad = calibration()
        bad['sites'].append('1')
        with self.assertRaises(ValueError):
            PooledSpreadDecrease(bad)
        bad = calibration()
        bad['baseline_sd'][next(iter(bad['baseline_sd']))] = float('nan')
        with self.assertRaises(ValueError):
            PooledSpreadDecrease(bad)
        bad = calibration()
        bad['config']['window_per_site'] = 999
        with self.assertRaises(ValueError):
            PooledSpreadDecrease(bad)

    def test_candidate_cannot_mutate_core_or_artifact(self):
        config = calibration()
        original = copy.deepcopy(config)
        run_stream(stream('decrease'), config)
        self.assertEqual(config, original)

    def test_output_scope_rejects_traversal_and_other_workstreams(self):
        self.assertEqual(output_path(OWNED / 'round3/safe.json'), (OWNED / 'round3/safe.json').resolve())
        for path in (OWNED / 'round3/../../prediction/x.json', OWNED / 'ROUND3.md', OWNED / 'round2/x.json'):
            with self.subTest(path=str(path)), self.assertRaises(ValueError):
                output_path(path)


if __name__ == '__main__':
    unittest.main()
