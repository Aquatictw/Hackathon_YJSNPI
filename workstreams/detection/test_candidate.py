"""Behavior checks for the offline proposal, separate from development accuracy."""
import copy
import json
import math
import unittest

import numpy as np

from workstreams.detection.candidate import DEFAULT_CONFIG, SpreadDecreaseCandidate, window_sd
from workstreams.detection.evaluate import fit_calibration


TESTS = [f"{i}_Main.synthetic.Test{i}#P" for i in range(20)]


def calibration():
    return {
        "config": dict(DEFAULT_CONFIG),
        "families": {"Main.synthetic": TESTS},
        "reference_sd": {str(site): dict.fromkeys(TESTS, 1.0) for site in range(1, 5)},
        "family_thresholds": {str(site): {"Main.synthetic": 0.05} for site in range(1, 5)},
        "calibration_sha256": "synthetic-fixture-not-real-calibration",
    }


def feed(detector, end, scale=0.1, missing=None):
    alerts = []
    while detector.completed < end:
        site = str(detector.completed % 4 + 1)
        order = detector.site_counts[site]
        value = scale if order % 2 else -scale
        values = dict.fromkeys(TESTS, value)
        if missing is not None:
            values[TESTS[0]] = missing
        detector.add(site, values)
        alerts.extend(detector.analyze())
    return alerts


class CandidateBehaviorTests(unittest.TestCase):
    def test_sd_is_stable_at_large_offsets_and_rejects_overflow(self):
        self.assertAlmostEqual(window_sd([1e12 - 1, 1e12 + 1] * 6), 1.0)
        self.assertIsNone(window_sd([-1e308, 1e308] * 6))

    def test_collapse_needs_full_windows_and_two_new_scans(self):
        detector = SpreadDecreaseCandidate(calibration())
        self.assertEqual(feed(detector, 48), [])
        self.assertEqual(detector.analyze(final=True), [])
        self.assertEqual(feed(detector, 55), [])
        alerts = feed(detector, 56)
        self.assertEqual(len(alerts), 4)
        self.assertTrue(all(a["completed_devices"] == 56 and a["persistence_scans"] == 2 for a in alerts))
        self.assertEqual(feed(detector, 96), [])
        json.dumps(alerts, allow_nan=False)
        self.assertEqual(alerts[0]["series_device_order"], list(range(3, 15)))
        self.assertEqual(alerts[0]["observed"], 0.1)

    def test_normal_spread_and_site_offset_do_not_alert(self):
        detector = SpreadDecreaseCandidate(calibration())
        alerts = []
        for i in range(80):
            site = str(i % 4 + 1)
            value = 100 * int(site) + (1 if i // 4 % 2 else -1)
            detector.add(site, dict.fromkeys(TESTS, value))
            alerts.extend(detector.analyze())
        self.assertEqual(alerts, [])

    def test_minimum_family_hits_blocks_single_test_outlier(self):
        detector = SpreadDecreaseCandidate(calibration())
        alerts = []
        for i in range(80):
            values = dict.fromkeys(TESTS, 1 if i // 4 % 2 else -1)
            values[TESTS[0]] = 0
            detector.add(str(i % 4 + 1), values)
            alerts.extend(detector.analyze())
        self.assertEqual(alerts, [])

    def test_missing_nan_and_infinity_fail_closed_without_shrinking_window(self):
        for missing in [float("nan"), float("inf"), "not-a-number"]:
            detector = SpreadDecreaseCandidate(calibration())
            self.assertEqual(feed(detector, 80, missing=missing), [])
            self.assertTrue(all(len(window) == 12 for tests in detector.windows.values() for window in tests.values()))
            self.assertTrue(all(scan["valid_tests"] == 19 for scan in detector.latest_scans))
        detector = SpreadDecreaseCandidate(calibration())
        for i in range(80):
            detector.add(str(i % 4 + 1), {})
            self.assertEqual(detector.analyze(), [])

    def test_invalid_window_breaks_persistence(self):
        detector = SpreadDecreaseCandidate(calibration())
        feed(detector, 48)
        self.assertTrue(all(v == 1 for v in detector.streak.values()))
        self.assertEqual(feed(detector, 56, missing=float("nan")), [])
        self.assertTrue(all(v == 0 for v in detector.streak.values()))

    def test_stale_site_cannot_receive_second_persistence_vote(self):
        detector = SpreadDecreaseCandidate(calibration())
        feed(detector, 48)
        alerts = []
        for i in range(8):
            detector.add("2", dict.fromkeys(TESTS, .1 if i % 2 else -.1))
            alerts.extend(detector.analyze())
        self.assertEqual({a["site"] for a in alerts}, {"2"})
        self.assertEqual(detector.streak[("1", "Main.synthetic")], 0)

    def test_unknown_site_invalidates_scope_and_new_instance_resets(self):
        detector = SpreadDecreaseCandidate(calibration())
        feed(detector, 48)
        detector.add("unexpected", dict.fromkeys(TESTS, 0))
        self.assertEqual(feed(detector, 80), [])
        self.assertTrue(detector.scope_invalid)
        fresh = SpreadDecreaseCandidate(calibration())
        self.assertEqual(feed(fresh, 48), [])
        self.assertEqual(len(feed(fresh, 56)), 4)

    def test_prefix_evidence_is_frozen_when_future_changes(self):
        left, right = SpreadDecreaseCandidate(calibration()), SpreadDecreaseCandidate(calibration())
        past_left, past_right = feed(left, 56), feed(right, 56)
        frozen = copy.deepcopy(past_left)
        feed(left, 80, scale=1000)
        feed(right, 80, scale=0)
        self.assertEqual(past_left, past_right)
        self.assertEqual(past_left, frozen)

    def test_bounded_capacity_and_retention(self):
        detector = SpreadDecreaseCandidate(calibration())
        feed(detector, 512)
        self.assertEqual(sum(len(seq) for site in detector.windows.values() for seq in site.values()), 4 * 20 * 12)
        oversized = calibration()
        oversized["config"]["maximum_tests"] = 19
        with self.assertRaises(ValueError):
            SpreadDecreaseCandidate(oversized)

    def test_calibration_ignores_every_nonfit_measurement(self):
        records, values = [], []
        for wafer in [2, 25]:
            for i in range(80):
                records.append({"Wafer": str(wafer), "Site": str(i % 4 + 1)})
                values.append([1 if i // 4 % 2 else -1] * len(TESTS))
        matrix = np.array(values, dtype=float)
        artifact = {"baselines": dict.fromkeys(TESTS, {}),
                    "detector_calibration": {"normal_fit_wafers": [2]}}
        hashes = {"grp6_app/artifacts/runtime.json": "fixture"}
        before = fit_calibration(artifact, TESTS, records, matrix, hashes)
        matrix[80:] = math.nan
        after = fit_calibration(artifact, TESTS, records, matrix, hashes)
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
