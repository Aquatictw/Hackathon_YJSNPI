"""Offline proposal: bounded, causal per-site dispersion screen (stdlib only).

One instance is one externally established run/tester/lot/wafer scope. Call add
exactly once per completed device, in completion order, and analyze after add.
The detector accepts no wafer identifiers, evaluation labels or future rows.
Calibration is frozen separately; this module never fits on the current wafer.
"""
from collections import deque
import math


DEFAULT_CONFIG = {
    "window_per_site": 12,
    "scan_interval_devices": 8,
    "minimum_completed_devices": 48,
    "minimum_family_tests": 20,
    "minimum_hits": 3,
    "minimum_hit_fraction": 0.05,
    "normal_fraction_margin": 0.02,
    "sd_ratio_limit": 0.70,
    "persistence_scans": 2,
    "maximum_tests": 4096,
    "maximum_sites": 8,
}


def family_of(test):
    return test.split("_", 1)[1].rsplit(".", 1)[0]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def window_sd(sequence):
    """Missing/nonfinite samples invalidate a full window, never shrink it."""
    if not sequence or any(not finite(value) for value in sequence):
        return None
    # Two passes around a local origin avoid large-offset cancellation and the
    # exact-rational overhead of statistics.pstdev on thousands of tiny windows.
    try:
        origin = sequence[0]
        offsets = [value - origin for value in sequence]
        mean_offset = math.fsum(offsets) / len(offsets)
        variance = math.fsum((value - mean_offset) ** 2 for value in offsets) / len(offsets)
        result = math.sqrt(variance)
    except (OverflowError, ValueError):
        return None
    return result if math.isfinite(result) else None


class SpreadDecreaseCandidate:
    def __init__(self, calibration):
        self.config = dict(calibration["config"])
        self.reference = calibration["reference_sd"]
        self.thresholds = calibration["family_thresholds"]
        self.calibration_sha256 = calibration["calibration_sha256"]
        self.families = calibration["families"]
        self.sites = tuple(sorted(self.reference))
        self.tests = tuple(sorted({test for tests in self.families.values() for test in tests}))
        if len(self.tests) > self.config["maximum_tests"] or len(self.sites) > self.config["maximum_sites"]:
            raise ValueError("Calibration exceeds bounded proposal capacity")
        if not self.sites or not self.tests:
            raise ValueError("Empty calibration")
        self.windows = {site: {test: deque(maxlen=self.config["window_per_site"])
                               for test in self.tests} for site in self.sites}
        self.orders = {site: deque(maxlen=self.config["window_per_site"]) for site in self.sites}
        self.site_counts = dict.fromkeys(self.sites, 0)
        self.streak = {}
        self.emitted = set()
        self.completed = 0
        self.last_analyzed = 0
        self.last_site_scanned = dict.fromkeys(self.sites, 0)
        self.latest_scans = []
        self.scope_invalid = False

    def add(self, site, values):
        self.completed += 1
        site = str(site)
        if site not in self.windows:
            # No baseline for this scope: fail closed until a new instance.
            self.scope_invalid = True
            return
        self.site_counts[site] += 1
        self.orders[site].append(self.site_counts[site])
        for test, sequence in self.windows[site].items():
            value = values.get(test)
            sequence.append(value if finite(value) else None)

    def analyze(self, final=False):
        # final does not bypass minimum counts or create an extra persistence vote.
        self.latest_scans = []
        cfg = self.config
        if (self.completed == self.last_analyzed or
                self.completed % cfg["scan_interval_devices"]):
            return []
        self.last_analyzed = self.completed
        if (self.scope_invalid or self.completed < cfg["minimum_completed_devices"] or
                any(count < cfg["window_per_site"] for count in self.site_counts.values())):
            self.streak.clear()
            return []
        alerts = []
        for site in self.sites:
            fresh = self.site_counts[site] > self.last_site_scanned[site]
            self.last_site_scanned[site] = self.site_counts[site]
            sds = {test: window_sd(sequence) for test, sequence in self.windows[site].items()}
            for family, tests in self.families.items():
                key = (site, family)
                valid = all(sds[test] is not None for test in tests)
                hits = [test for test in tests if sds[test] is not None and
                        sds[test] <= self.reference[site][test] * cfg["sd_ratio_limit"]]
                fraction = len(hits) / len(tests)
                threshold = self.thresholds[site][family]
                passed = (fresh and valid and len(hits) >= cfg["minimum_hits"] and fraction > threshold)
                self.streak[key] = self.streak.get(key, 0) + 1 if passed else 0
                scan = {
                    "completed_devices": self.completed, "site": site, "family": family,
                    "sample_count_per_test": cfg["window_per_site"],
                    "family_tests": len(tests), "valid_tests": sum(sds[t] is not None for t in tests),
                    "hits": len(hits), "hit_fraction": fraction, "threshold": threshold,
                    "fresh_site_samples": fresh,
                    "score": fraction / threshold, "passed": passed,
                    "persistence_scans": self.streak[key], "direction": "down",
                }
                self.latest_scans.append(scan)
                if self.streak[key] < cfg["persistence_scans"] or key in self.emitted:
                    continue
                self.emitted.add(key)
                test = min(hits, key=lambda name: sds[name] / self.reference[site][name])
                reference = self.reference[site][test]
                alerts.append({
                    **scan, "kind": "spread_down", "test": test,
                    "detector": "normal_reference_site_window_v1",
                    "message": f"{family} site {site}: {len(hits)}/{len(tests)} tests have SD at most 70% of normal reference",
                    "observed": sds[test], "reference": reference,
                    "series": list(self.windows[site][test]),
                    "series_device_order": list(self.orders[site]),
                    "site_series": {s: list(self.windows[s][test]) for s in self.sites},
                    "site_series_device_order": {s: list(self.orders[s]) for s in self.sites},
                    "baseline": {
                        "sd": reference, "statistic": "median normal per-site window population SD",
                        "calibration_sha256": self.calibration_sha256,
                        "thresholds": {"sd_ratio_limit": cfg["sd_ratio_limit"],
                                       "family_hit_fraction": threshold},
                    },
                    "units": "source CSV units; physical units unverified",
                    "axis": "completed-device order within site",
                    "score_semantics": "family hit fraction / threshold; not a probability",
                    "suggestion": "Check clipping, stale results, and measurement range changes; compare raw per-site values.",
                })
        return alerts
