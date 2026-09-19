"""Differential behavior, measurement accounting and output ownership checks."""
import copy
import math
import random
import subprocess
import sys
import unittest

from grp6_app.runtime import WaferDetector
from workstreams.detection.profile_detector import (
    OWNED, ROOT, SiteKeyDetector, canonical, compare_runs, output_path,
    read_wafer, retained_state, run_once, state_digest, timings,
)


def artifact(family_gates=True):
    return {'baselines': {f'{i}_Main.synthetic.Test{i}#P': {
                'mean': 0., 'sd': 1., 'thresholds': {
                    'site_imbalance': .2, 'mean_drift_up': .2,
                    'mean_drift_down': .2, 'spread_up': .1, 'spread_down': .1}}
                for i in range(6)},
            'family_thresholds': {'Main.synthetic': [.1, .1, .1, .1]} if family_gates else {}}


class ProfileTests(unittest.TestCase):
    def test_differential_alerts_and_internal_state_at_every_callback(self):
        rng = random.Random(1936)
        config = artifact()
        baseline = WaferDetector(config['baselines'], config['family_thresholds'])
        candidate = SiteKeyDetector(config['baselines'], config['family_thresholds'])
        all_alerts = []
        for i in range(161):
            site = i % 4 + 1
            site = str(site) if i % 3 else site
            values = {name: int(site) * 3 + rng.uniform(-1, 1) * (1 if i < 80 else .01)
                      + (0 if i < 64 else 5) for name in config['baselines']}
            values['unknown'] = math.inf
            if i % 11 == 0:
                values[next(iter(values))] = math.nan
            if i % 13 == 0:
                values.pop(list(config['baselines'])[1], None)
            for detector in (baseline, candidate):
                detector.add(site, values, i % 3 == 0)
            left, right = baseline.analyze(), candidate.analyze()
            self.assertEqual(canonical(left), canonical(right))
            self.assertEqual(state_digest(baseline), state_digest(candidate))
            all_alerts.extend(left)
            self.assertEqual(baseline.analyze(), candidate.analyze())
        self.assertEqual(canonical(baseline.analyze(True)), canonical(candidate.analyze(True)))
        self.assertEqual(state_digest(baseline), state_digest(candidate))
        self.assertTrue({'low_yield', 'site_imbalance'} <= {a['kind'] for a in all_alerts})
        self.assertIs(SiteKeyDetector.analyze, WaferDetector.analyze)

    def test_residual_finalization_emits_equal_evidence(self):
        # 23/33 passes: Wilson upper bound blocks streaming low yield; final allows it.
        rows = [('1', {}, i < 23) for i in range(33)]
        baseline = run_once(WaferDetector, artifact(), rows)
        candidate = run_once(SiteKeyDetector, artifact(), rows)
        compare_runs(baseline, candidate)
        self.assertTrue(baseline['finalization_performed_scan'])
        self.assertFalse(any(call['alerts'] for call in baseline['trace'][:-1]))
        self.assertEqual(baseline['trace'][-1]['alerts'][0]['kind'], 'low_yield')
        self.assertEqual(baseline['trace'][-1]['alerts'][0]['completed_devices'], 33)

    def test_boundary_finalization_and_phase_accounting(self):
        result = run_once(WaferDetector, artifact(), [('1', {}, True)] * 80)
        samples = result['samples_ms']
        self.assertEqual({k: len(v) for k, v in samples.items()}, {
            'constructor': 1, 'ingestion': 80, 'scheduled_scan': 10,
            'active_scan': 8, 'warmup_scan': 2, 'skipped_scan': 70,
            'device_total': 80, 'finalization': 1, 'wafer_total': 1})
        self.assertFalse(result['finalization_performed_scan'])
        self.assertEqual(result['trace'][-1]['alerts'], [])
        analyze_sum = sum(samples['scheduled_scan']) + sum(samples['skipped_scan'])
        self.assertAlmostEqual(sum(samples['device_total']), sum(samples['ingestion']) + analyze_sum)
        self.assertGreaterEqual(samples['wafer_total'][0], sum(samples['device_total']))

    def test_equivalence_guard_rejects_position_evidence_and_state_changes(self):
        baseline = run_once(WaferDetector, artifact(), [('1', {}, False)] * 32)
        for mutate in (
            lambda r: r['trace'][-2]['alerts'][0].update(completed_devices=31),
            lambda r: r['trace'][-2]['alerts'][0].update(observed=.1),
            lambda r: r.update(state_sha256='changed'),
        ):
            changed = copy.deepcopy(baseline)
            mutate(changed)
            with self.assertRaises(AssertionError):
                compare_runs(baseline, changed)

    def test_empty_nonfinite_and_integer_string_site_identity(self):
        config = artifact(False)
        name = next(iter(config['baselines']))
        rows = [(1, {}, True), ('1', {name: math.nan}, False),
                (1, {name: math.inf}, False), ('1', {name: -math.inf}, True),
                (1, {name: 3.0}, True), ('1', {name: 4.0}, True)]
        left = run_once(WaferDetector, config, rows)
        right = run_once(SiteKeyDetector, config, rows)
        compare_runs(left, right)
        self.assertEqual(right['retained']['test_site_series'], 1)
        self.assertEqual(right['retained']['global_sample_references'], 2)
        compare_runs(run_once(WaferDetector, config, []), run_once(SiteKeyDetector, config, []))

    def test_retention_grows_with_devices_and_fresh_instance_resets(self):
        config = artifact()
        for kind in (WaferDetector, SiteKeyDetector):
            detector = kind(config['baselines'], config['family_thresholds'])
            for count in (80, 160):
                while detector.completed < count:
                    detector.add(detector.completed % 4, dict.fromkeys(config['baselines'], 1.0), True)
                retained = retained_state(detector)
                self.assertEqual(retained['global_sample_references'], count * 6)
                self.assertEqual(retained['site_sample_references'], count * 6)
                self.assertEqual(retained['yield_samples'], count)
                self.assertEqual(retained['test_site_series'], 24)
            fresh = kind(config['baselines'], config['family_thresholds'])
            self.assertEqual(retained_state(fresh)['global_sample_references'], 0)

    def test_output_confinement_precedes_any_input_read_or_write(self):
        self.assertEqual(output_path(OWNED / 'round2/profile.json'), OWNED / 'round2/profile.json')
        for bad in (ROOT / 'profile.json', OWNED / 'round2/../../escape.json',
                    OWNED / 'round2/../evidence/new.json', OWNED / 'round2/profile.py'):
            with self.assertRaises(ValueError):
                output_path(bad)
        result = subprocess.run([sys.executable, '-B', '-m', 'workstreams.detection.profile_detector',
                                 '--output', str(ROOT / 'forbidden-profile.json')],
                                cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Output must be a JSON file', result.stderr)
        self.assertFalse((ROOT / 'forbidden-profile.json').exists())

    def test_percentile_method_and_empty_samples(self):
        stats = timings([10., 0., 20., 30.])
        self.assertEqual(stats['p50_ms'], 15.)
        self.assertAlmostEqual(stats['p95_ms'], 28.5)
        self.assertEqual(stats['sum_ms'], 60.)
        self.assertEqual(timings([2.])['p95_ms'], 2.)
        self.assertIsNone(timings([])['p50_ms'])

    def test_csv_reader_preserves_order_sites_and_w2_yield(self):
        wafer, rows = read_wafer(ROOT / 'source_review/training/Data/A12345_W02_RawResult.csv')
        self.assertEqual(wafer, 2)
        self.assertEqual(len(rows), 80)
        self.assertTrue(all(isinstance(site, str) for site, _, _ in rows))
        self.assertEqual(sum(row[2] for row in rows) / len(rows), .5375)


if __name__ == '__main__':
    unittest.main()
