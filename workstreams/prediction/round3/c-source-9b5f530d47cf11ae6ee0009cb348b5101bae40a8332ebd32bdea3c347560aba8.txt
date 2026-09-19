"""R3 causal, bounded spread-decrease proposal. Stdlib-only online arithmetic.

Each instance belongs to one trusted run/tester/lot/wafer scope. add consumes only
the current completed device; it accepts no wafer identity, labels or final bins.
Sites and tests come from a frozen calibration. Missing values retain their
positions, fail closed per test, and cannot silently become zero/shorter windows.
"""
from collections import deque
import math


CONFIG = {
    'window_per_site': 20, 'minimum_per_site': 8, 'scan_interval': 8,
    'minimum_family_tests': 20, 'family_quantile': .95,
    'minimum_valid_fraction': .95, 'minimum_hits': 3,
    'persistence_scans': 2, 'normal_margin': 1.2,
    'minimum_log_drop': math.log(2), 'sd_floor_fraction': .1,
}


def family_of(test):
    return test.split('_', 1)[-1].rsplit('.', 1)[0]

def quantile(values, q):
    ordered = sorted(values)
    pos = q * (len(ordered) - 1)
    i = int(pos)
    return ordered[i] + (ordered[min(i + 1, len(ordered) - 1)] - ordered[i]) * (pos - i)

def variance(values):
    # Stable two-pass centering; avoids sum(x*x)-sum(x)**2 cancellation.
    origin = values[0]
    delta = [v - origin for v in values]
    mean = sum(delta) / len(delta)
    return sum((v - mean) ** 2 for v in delta) / len(delta)


class PooledSpreadDecrease:
    def __init__(self, calibration):
        self.config = dict(calibration['config'])
        if self.config != CONFIG:
            raise ValueError('Unsupported candidate configuration')
        self.sites = tuple(calibration['sites'])
        self.families = {f: tuple(ts) for f, ts in calibration['families'].items()}
        tests = [t for ts in self.families.values() for t in ts]
        if (not 1 <= len(self.sites) <= 8 or len(set(self.sites)) != len(self.sites)
                or any(not isinstance(s, str) for s in self.sites)
                or not tests or len(tests) > 4096 or len(set(tests)) != len(tests)
                or any(len(ts) < CONFIG['minimum_family_tests'] for ts in self.families.values())):
            raise ValueError('Invalid bounded site/test layout')
        self.baseline_sd = {t: float(calibration['baseline_sd'][t]) for t in tests}
        self.thresholds = {f: float(calibration['thresholds'][f]) for f in self.families}
        if (any(not math.isfinite(v) or v <= 0 for v in self.baseline_sd.values())
                or any(not math.isfinite(v) or v < CONFIG['minimum_log_drop']
                       for v in self.thresholds.values())):
            raise ValueError('Invalid frozen scale/threshold')
        self.calibration_sha256 = calibration['calibration_sha256']
        self.windows = {s: {t: deque(maxlen=CONFIG['window_per_site']) for t in tests}
                        for s in self.sites}
        self.orders = {s: deque(maxlen=CONFIG['window_per_site']) for s in self.sites}
        self.site_counts = dict.fromkeys(self.sites, 0)
        self.last_site_counts = dict.fromkeys(self.sites, 0)
        self.streak = dict.fromkeys(self.families, 0)
        self.completed = self.last_analyzed = 0
        self.emitted = False
        self.invalid_scope = False
        self.latest_scans = []

    def add(self, site, values):
        self.completed += 1
        site = str(site)
        if site not in self.windows:
            self.invalid_scope = True
            return
        self.site_counts[site] += 1
        self.orders[site].append(self.completed)
        for test, window in self.windows[site].items():
            value = values.get(test)
            try:
                value = float(value) if value is not None and not isinstance(value, bool) else None
            except (TypeError, ValueError, OverflowError):
                value = None
            window.append(value if value is not None and math.isfinite(value) else None)

    def analyze(self, final=False):
        self.latest_scans = []
        # Finalization cannot manufacture an extra vote or rescan the same data.
        if self.completed == self.last_analyzed or self.completed % CONFIG['scan_interval']:
            return []
        self.last_analyzed = self.completed
        fresh = all(self.site_counts[s] > self.last_site_counts[s] for s in self.sites)
        self.last_site_counts = dict(self.site_counts)
        ready = (not self.invalid_scope and fresh
                 and all(len(self.orders[s]) >= CONFIG['minimum_per_site'] for s in self.sites))
        if not ready:
            self.streak = dict.fromkeys(self.families, 0)
            return []
        candidates = []
        for family, tests in self.families.items():
            metrics = {}
            for test in tests:
                early, late = [], []
                for site in self.sites:
                    seq = list(self.windows[site][test])
                    if any(v is None for v in seq):
                        break
                    half = len(seq) // 2
                    try:
                        a, b = variance(seq[:half]), variance(seq[-half:])
                    except OverflowError:
                        break
                    if not math.isfinite(a) or not math.isfinite(b):
                        break
                    early.append(a)
                    late.append(b)
                if len(early) != len(self.sites):
                    continue
                first_sd = math.sqrt(sum(v / len(early) for v in early))
                last_sd = math.sqrt(sum(v / len(late) for v in late))
                floor = self.baseline_sd[test] * CONFIG['sd_floor_fraction']
                score = math.log(max(first_sd, floor)) - math.log(max(last_sd, floor))
                metrics[test] = (score, first_sd, last_sd)
            # Invalid tests vote zero with the FIXED family denominator. Removing
            # high-variance tests must never inflate the lower-spread hit fraction.
            scores = [metrics[t][0] if t in metrics else 0. for t in tests]
            value = quantile(scores, CONFIG['family_quantile'])
            threshold = self.thresholds[family]
            hits = [t for t in tests if t in metrics and metrics[t][0] > threshold]
            passed = (len(metrics) >= math.ceil(len(tests) * CONFIG['minimum_valid_fraction'])
                      and len(hits) >= CONFIG['minimum_hits'] and value > threshold)
            self.streak[family] = min(CONFIG['persistence_scans'], self.streak[family] + 1) if passed else 0
            scan = {'family': family, 'completed_devices': self.completed,
                    'family_tests': len(tests), 'valid_tests': len(metrics),
                    'hits': len(hits), 'statistic': value, 'threshold': threshold,
                    'score': value / threshold, 'passed': passed,
                    'persistence_scans': self.streak[family],
                    'site_samples': {s: len(self.orders[s]) for s in self.sites}}
            self.latest_scans.append(scan)
            if self.streak[family] >= CONFIG['persistence_scans'] and not self.emitted:
                # The representative is near the gated quantile, not the most
                # extreme individual test. Full contributing test names retained.
                test = min(hits, key=lambda t: abs(metrics[t][0] - value))
                _, first_sd, last_sd = metrics[test]
                series = {s: list(self.windows[s][test]) for s in self.sites}
                candidates.append({**scan, 'kind': 'spread_down', 'site': 'all',
                    'test': test, 'observed': last_sd, 'reference': first_sd,
                    'detector': 'pooled_within_site_temporal_q95_v1',
                    'message': f'{family}: pooled within-site spread decreased in {len(hits)}/{len(tests)} tests',
                    'series': [v for _, v in sorted((n, v) for s in self.sites
                               for n, v in zip(self.orders[s], series[s]))],
                    'site_series': series,
                    'site_series_device_order': {s: list(self.orders[s]) for s in self.sites},
                    'supporting_tests': hits,
                    'baseline': {'sd': self.baseline_sd[test],
                        'thresholds': {'family_log_drop': threshold},
                        'calibration_sha256': self.calibration_sha256},
                    'score_semantics': 'family q95 log SD decrease / frozen threshold; not probability',
                    'axis': 'completed-device order; site histories have independent early/late halves',
                    'units': 'source CSV units; physical units unverified',
                    'suggestion': 'Check clipping, stale results, range changes and transient settling; inspect the raw site traces.'})
        if not candidates:
            return []
        self.emitted = True
        return [max(candidates, key=lambda a: a['score'])]

    def state_bound(self):
        tests = sum(map(len, self.families.values()))
        return {'tests': tests, 'sites': len(self.sites),
                'maximum_measurement_slots': tests * len(self.sites) * CONFIG['window_per_site'],
                'retained_measurement_slots': sum(len(v) for ts in self.windows.values() for v in ts.values()),
                'maximum_order_slots': len(self.sites) * CONFIG['window_per_site']}
