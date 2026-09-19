"""Tests for B's independent arithmetic and acceptance oracle."""
import math
import unittest

import numpy as np

from workstreams.prediction.challenge_pooled import family_score, oracle
from workstreams.prediction.spread_audit import PREFIXES, temporal_dispersion


class PooledChallengeChecks(unittest.TestCase):
    def test_pool_variances_then_log_is_not_average_site_log(self):
        sites = np.array(['1', '2', '3', '4'] * 20)
        x = np.repeat(np.tile([-1., 1.], 10), 4)[:, None]
        x[:40][sites[:40] == '1'] *= 10
        stats = temporal_dispersion(x, sites, 80, np.array([.1]))
        pooled = -np.log(stats['within'][2][0])
        meanlog = np.mean([-np.log(stats[s][2][0]) for s in ('1', '2', '3', '4')])
        self.assertAlmostEqual(pooled, math.log(math.sqrt(103 / 4)))
        self.assertAlmostEqual(meanlog, math.log(10) / 4)
        self.assertGreater(pooled, math.log(2))
        self.assertLess(meanlog, math.log(2))

    def test_q95_exposes_sparse_test_tail_that_q80_misses(self):
        scores = np.zeros(500); scores[-30:] = 1.5
        self.assertTrue(family_score(scores, list(range(500)), .95, math.log(2))[2])
        self.assertFalse(family_score(scores, list(range(500)), .8, math.log(2))[2])

    def test_missing_tests_keep_fixed_denominator_and_validity_gate(self):
        scores = np.zeros(500); scores[-30:] = 1.5; scores[:26] = np.nan
        self.assertFalse(family_score(scores, list(range(500)), .95, math.log(2))[2])
        scores[:26] = 0; scores[-26:] = np.nan
        self.assertFalse(family_score(scores, list(range(500)), .95, math.log(2))[2])

    def test_nonreference_wafer_changes_cannot_change_threshold(self):
        scores = {(w, n): np.full(24, .2) for w in range(1, 26) for n in PREFIXES}
        gates, _, _ = oracle(scores, {'f': list(range(24))}, [2, 4])
        for n in PREFIXES:
            scores[25, n] *= 100
        after, _, additions = oracle(scores, {'f': list(range(24))}, [2, 4])
        self.assertEqual(gates, after)
        self.assertEqual(gates['f'], math.log(2))
        self.assertEqual(additions[25]['completed_devices'], 40)

    def test_two_scans_needed_and_streak_resets(self):
        scores = {(w, n): np.zeros(24) for w in range(1, 26) for n in PREFIXES}
        for n in (32, 48, 56):
            scores[25, n][:] = 1
        _, _, additions = oracle(scores, {'f': list(range(24))}, [2, 4])
        self.assertEqual(additions[25]['completed_devices'], 56)


if __name__ == '__main__':
    unittest.main()
