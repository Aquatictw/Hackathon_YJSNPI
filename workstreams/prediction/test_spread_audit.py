"""Independent R3 audit regressions, not detector/live acceptance."""
import copy
import csv
import io
from pathlib import Path
import unittest

import numpy as np

from workstreams.prediction.spread_audit import (
    EXPECTED, OWNED, acceptance_matrix, compare_alerts, dispersion,
    family_scores, moments, output_directory, parse_export, reference_sd, synthetic_controls,
    temporal_dispersion, write_json, write_csv_gz,
)


def summaries():
    records = []
    for w in range(1, 26):
        kind = EXPECTED.get(w) if w != 25 else None
        if w == 2:
            kind = 'low_yield'
        alerts = [{'kind': kind, 'site': 'all', 'test': 'test', 'completed_devices': 32}] if kind else []
        records.append({'wafer': w, 'devices': 80, 'alerts': alerts})
    baseline = {'wafers': records}
    candidate = copy.deepcopy(baseline)
    candidate['wafers'][24]['alerts'].append(
        {'kind': 'spread_down', 'site': '1', 'test': 'test', 'completed_devices': 64})
    return baseline, candidate


class DispersionChecks(unittest.TestCase):
    def test_population_sd_and_nonfinite_counts(self):
        n, mean, sd = moments(np.array([[1., np.nan], [3., np.inf]]))
        np.testing.assert_array_equal(n, [2, 0])
        self.assertEqual(mean[0], 2)
        self.assertEqual(sd[0], 1)
        self.assertTrue(np.isnan(sd[1]))

    def test_one_sample_is_not_zero_spread(self):
        self.assertTrue(np.isnan(moments(np.array([[8.]]))[2][0]))

    def test_constant_observed_is_zero_but_constant_reference_is_unknown(self):
        x = np.ones((8, 2))
        stats = dispersion(x, ['1', '2', '3', '4'] * 2, 8)
        self.assertEqual(stats['within'][2][0], 0)
        _, median, minimum = reference_sd({(1, 8): stats}, [1], 2, 8, 'within')
        self.assertTrue(np.isnan(median).all())
        self.assertTrue(np.isnan(minimum).all())

    def test_subject_excluded_from_normal_reference(self):
        def stats(sd):
            return {'within': (None, None, np.array([sd]))}
        refs, median, minimum = reference_sd({(1, 32): stats(.001), (2, 32): stats(2),
                                              (3, 32): stats(4)}, [1, 2, 3], 1, 32, 'within')
        self.assertEqual(refs, [2, 3])
        self.assertEqual(median[0], 3)
        self.assertEqual(minimum[0], 2)

    def test_missing_reference_not_silently_imputed(self):
        stats = {(1, 32): {'within': (None, None, np.array([1.]))},
                 (2, 32): {'within': (None, None, np.array([np.nan]))}}
        _, median, _ = reference_sd(stats, [1, 2], 3, 32, 'within')
        self.assertTrue(np.isnan(median[0]))

    def test_unknown_site_fails_within_closed(self):
        result = dispersion(np.arange(18.).reshape(9, 2), ['1', '2', '3', '4'] * 2 + ['5'], 9)
        self.assertTrue(np.isnan(result['within'][2]).all())

    def test_synthetic_no_change_shift_missing_and_future_controls(self):
        self.assertTrue(synthetic_controls()['pass'])

    def test_temporal_reduction_within_each_site(self):
        x = np.tile(np.repeat(np.tile([-1., 1.], 10), 4)[:, None], (1, 3))
        x[40:] *= .25
        result = temporal_dispersion(x, ['1', '2', '3', '4'] * 20, 80, np.full(3, .1))
        np.testing.assert_allclose(result['within'][2], [.25] * 3)
        self.assertEqual(result['1'][0][0], 10)

    def test_temporal_missing_does_not_compact_across_gap(self):
        x = np.tile(np.arange(80.)[:, None], (1, 3))
        x[20, 0] = np.nan
        result = temporal_dispersion(x, ['1', '2', '3', '4'] * 20, 80, np.full(3, .1))
        self.assertTrue(np.isnan(result['1'][2][0]))
        self.assertTrue(np.isnan(result['within'][2][0]))
        self.assertTrue(np.isfinite(result['2'][2][0]))

    def test_temporal_future_rows_do_not_change_prefix(self):
        x = np.tile(np.arange(80.)[:, None], (1, 3))
        sites = ['1', '2', '3', '4'] * 20
        before = temporal_dispersion(x, sites, 40, np.full(3, .1))
        x[40:] = np.nan
        after = temporal_dispersion(x, sites, 40, np.full(3, .1))
        np.testing.assert_array_equal(before['within'][2], after['within'][2])

    def test_site_name_permutation_preserves_within_sd(self):
        x = np.arange(48.).reshape(24, 2)
        left = dispersion(x, ['1', '2', '3', '4'] * 6, 24)
        right = dispersion(x, ['4', '2', '1', '3'] * 6, 24)
        np.testing.assert_allclose(left['within'][2], right['within'][2])

    def test_family_denominator_reports_missing(self):
        result = family_scores(np.array([.2, .8, np.nan]), np.array([1., 1., 1.]), [0, 1, 2])
        self.assertEqual(result['tests'], 3)
        self.assertEqual(result['eligible'], 2)
        self.assertEqual(result['fraction_below_0_7'], .5)

    def test_no_eligible_family_is_unknown(self):
        result = family_scores(np.array([0.]), np.array([np.nan]), [0])
        self.assertEqual(result['eligible'], 0)
        self.assertIsNone(result['fraction_below_0_7'])

    def test_quality_parser_distinguishes_blank_nonfinite_and_malformed(self):
        out = io.StringIO(); writer = csv.writer(out)
        writer.writerow(['PID', 'Lot', 'Wafer', 'Site', 'X', 'Y', 'PF', 'SBin', 'HBin', 'Test Time',
                         '1_a', '2_b', '3_c', '4_d', '5_e'])
        writer.writerows([[]] * 4)
        writer.writerow(['1', 'lot', '25', '1', '0', '0', 'P', '1', '1', '1',
                         '', 'NaN', 'Infinity', 'bad', '3.5'])
        names, meta, values, flags = parse_export(out.getvalue().encode())
        self.assertEqual(flags.tolist(), [[1, 2, 2, 3, 0]])
        self.assertEqual(values[0, 4], 3.5)
        self.assertEqual(len(names), 5)
        self.assertEqual(meta[0]['Wafer'], '25')


class AcceptanceChecks(unittest.TestCase):
    def test_baseline_fails_only_w25(self):
        baseline, _ = summaries()
        result = compare_alerts(baseline, baseline)
        self.assertEqual([k for k, passed in result['checks'].items() if not passed], ['w25_spread_down'])

    def test_w25_addition_passes_wafer_gates_but_not_unrun_controls(self):
        result = compare_alerts(*summaries())
        self.assertTrue(result['all_wafer_gates_pass'])
        self.assertEqual(len(result['normal_label_wafers']), 18)
        self.assertIn('NOT_EVALUATED', result['candidate_controls_and_causality'])

    def test_each_normal_wafer_extra_alert_fails_including_fit_and_w2(self):
        for w in range(1, 26):
            if w in EXPECTED:
                continue
            with self.subTest(wafer=w):
                baseline, candidate = summaries()
                candidate['wafers'][w-1]['alerts'].append(
                    {'kind': 'spread_down', 'completed_devices': 64})
                self.assertFalse(compare_alerts(baseline, candidate)['checks']['all_normal_labels_no_extra_alerts'])

    def test_w2_low_yield_must_not_be_suppressed(self):
        baseline, candidate = summaries()
        candidate['wafers'][1]['alerts'] = []
        self.assertFalse(compare_alerts(baseline, candidate)['checks']['w2_low_yield_preserved'])

    def test_other_labeled_category_cannot_be_delayed(self):
        baseline, candidate = summaries()
        candidate['wafers'][13]['alerts'][0]['completed_devices'] = 40
        self.assertFalse(compare_alerts(baseline, candidate)['checks']['other_expected_categories_no_later'])

    def test_duplicate_extra_alert_not_deduplicated_away(self):
        baseline, candidate = summaries()
        candidate['wafers'][1]['alerts'] *= 2
        self.assertFalse(compare_alerts(baseline, candidate)['checks']['all_normal_labels_no_extra_alerts'])

    def test_extra_abnormal_category_reported(self):
        baseline, candidate = summaries()
        candidate['wafers'][0]['alerts'].append({'kind': 'spread_down', 'completed_devices': 56})
        result = compare_alerts(baseline, candidate)
        self.assertTrue(result['all_wafer_gates_pass'])
        self.assertEqual(len(result['wafer_results'][0]['added']), 1)

    def test_missing_or_duplicate_wafer_rejected(self):
        baseline, candidate = summaries()
        candidate['wafers'][24] = candidate['wafers'][0]
        with self.assertRaises(ValueError):
            compare_alerts(baseline, candidate)

    def test_future_or_invalid_alert_count_rejected(self):
        for n in (81, 0, float('nan'), True, 3.5):
            baseline, candidate = summaries()
            candidate['wafers'][24]['alerts'][0]['completed_devices'] = n
            with self.subTest(n=n), self.assertRaises(ValueError):
                compare_alerts(baseline, candidate)

    def test_missing_devices_rejected(self):
        baseline, candidate = summaries()
        candidate['wafers'][5]['devices'] = 79
        with self.assertRaises(ValueError):
            compare_alerts(baseline, candidate)

    def test_output_rejects_parent_and_sibling_escape(self):
        for path in (OWNED, OWNED / '..' / 'detection' / 'bad', OWNED / 'round3' / '..' / '..' / 'bad'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                output_directory(path)
        self.assertEqual(output_directory(OWNED / 'round3'), OWNED / 'round3')

    def test_matrix_never_calls_reused_data_independent_validation(self):
        self.assertIn('not independent validation', acceptance_matrix()['data_status'])

    def test_output_writers_reject_outside_path_before_writing(self):
        with self.assertRaises(ValueError):
            write_json(OWNED.parent / 'outside.json', {})
        with self.assertRaises(ValueError):
            write_csv_gz(OWNED.parent / 'outside.csv.gz', [], [])


if __name__ == '__main__':
    unittest.main()
