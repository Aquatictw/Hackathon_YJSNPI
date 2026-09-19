"""Sparse extreme-burst spread-down supplement; Python stdlib only.

Each completed device is scored against frozen normal-fit site/test robust
baselines. A measurement is extreme when abs(value - median) / scale exceeds
the artifact z limit; a device with at least the artifact minimum of extreme
tests inside one family is a burst device for that family. At frozen scan
positions the completed prefix splits into equal early/recent halves. A family
passes only when its early burst count strictly exceeds the normal-fit maximum
for that position, exceeds the recent count, and a one-sided Fisher exact test
(early > recent) is at or below the artifact alpha. Any device in the prefix
with less than the artifact minimum coverage of a family's calibrated tests
makes that family abstain, so missing or nonfinite data cannot fake a decrease.

Every limit comes from the artifact. A missing or invalid artifact, an unknown
site or a position without a normal-fit floor never passes (fail closed). The
supplement never reads wafer identity, labels, bins or devices that have not
completed; create a fresh instance for each wafer scope.
"""
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

DETECTOR_ID = 'sparse_burst_spread_down_v1'
ARTIFACT_NAME = 'sparse_burst.json'
ARTIFACT_VERSION = 1
MAX_SERIES = 320
MAX_EVIDENCE_TESTS = 40
SUGGESTION = ('Extreme-result bursts became rarer: compare early burst devices for contact, '
              'range or settling faults and confirm whether the early extremes were transient.')


def family_of(test):
    """Family naming shared with the core detector's related-suite gate."""
    return test.split('_', 1)[-1].rsplit('.', 1)[0]


def fisher_early_greater(early, early_n, recent, recent_n):
    """One-sided Fisher exact p-value P(X >= early) for early > recent rates."""
    total, bursts = early_n + recent_n, early + recent
    if early_n <= 0 or recent_n <= 0 or bursts == 0:
        return 1.
    numerator = sum(math.comb(early_n, i) * math.comb(recent_n, bursts - i)
                    for i in range(early, min(bursts, early_n) + 1))
    return min(1., numerator / math.comb(total, bursts))


def _finite_json(value):
    return value if math.isfinite(value) else math.copysign(1e300, value)


def _number(config, key, integer=False):
    value = config.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError('config {} must be numeric'.format(key))
    if integer and (not isinstance(value, int) or value < 1):
        raise ValueError('config {} must be a positive integer'.format(key))
    if not math.isfinite(value) or value <= 0:
        raise ValueError('config {} must be finite and positive'.format(key))
    return value


class BurstCalibration:
    """Validated read-only view of a sparse-burst artifact, shared by wafers."""

    def __init__(self, artifact, sha256=None):
        if not isinstance(artifact, dict) or artifact.get('detector') != DETECTOR_ID \
                or artifact.get('version') != ARTIFACT_VERSION:
            raise ValueError('not a {} version {} artifact'.format(DETECTOR_ID, ARTIFACT_VERSION))
        config = artifact.get('config')
        if not isinstance(config, dict):
            raise ValueError('missing config')
        self.z_threshold = float(_number(config, 'z_threshold'))
        self.min_extreme_tests = _number(config, 'min_extreme_tests', True)
        self.first_scan = _number(config, 'first_scan_devices', True)
        self.interval = _number(config, 'scan_interval_devices', True)
        self.alpha = float(_number(config, 'fisher_alpha'))
        if self.alpha >= 1:
            raise ValueError('config fisher_alpha must be below 1')
        self.min_coverage = float(_number(config, 'min_family_coverage'))
        if self.min_coverage > 1:
            raise ValueError('config min_family_coverage must not exceed 1')
        families = artifact.get('families')
        if not isinstance(families, dict) or not families:
            raise ValueError('missing families')
        self.families = sorted(families)
        self.test_family = {}
        for family, tests in families.items():
            if not isinstance(tests, list) or not tests:
                raise ValueError('family {} has no tests'.format(family))
            for test in tests:
                if not isinstance(test, str) or family_of(test) != family or test in self.test_family:
                    raise ValueError('invalid test {!r} in family {}'.format(test, family))
                self.test_family[test] = family
        baselines = artifact.get('baselines')
        if not isinstance(baselines, dict) or not baselines:
            raise ValueError('missing site baselines')
        self.baselines = {}
        for site, tests in baselines.items():
            if not isinstance(tests, dict) or not tests:
                raise ValueError('site {} has no baselines'.format(site))
            table = {}
            for test, pair in tests.items():
                if test not in self.test_family or not isinstance(pair, list) or len(pair) != 2:
                    raise ValueError('invalid baseline for {!r}'.format(test))
                median, scale = pair
                if isinstance(median, bool) or isinstance(scale, bool) \
                        or not isinstance(median, (int, float)) or not isinstance(scale, (int, float)) \
                        or not math.isfinite(median) or not math.isfinite(scale) or scale <= 0:
                    raise ValueError('nonfinite or nonpositive baseline for {!r}'.format(test))
                table[test] = (float(median), float(scale))
            self.baselines[str(site)] = table
        self.site_family_tests = {site: Counter(self.test_family[test] for test in table)
                                  for site, table in self.baselines.items()}
        floors = artifact.get('normal_max_early_bursts')
        if not isinstance(floors, dict) or not floors:
            raise ValueError('missing normal_max_early_bursts')
        self.floors = {}
        for family, positions in floors.items():
            if family not in families or not isinstance(positions, dict):
                raise ValueError('invalid floor family {!r}'.format(family))
            self.floors[family] = {}
            for position, value in positions.items():
                if not isinstance(position, str) or not position.isdigit():
                    raise ValueError('invalid floor position {!r}'.format(position))
                count = int(position)
                if count < self.first_scan or (count - self.first_scan) % self.interval:
                    raise ValueError('floor at unscanned position {}'.format(count))
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise ValueError('invalid floor {!r}'.format(value))
                self.floors[family][count] = value
        self.sha256 = sha256
        self.normal_fit_wafers = list(artifact.get('provenance', {}).get('normal_fit_wafers', []))

    def floor(self, family, completed):
        return self.floors.get(family, {}).get(completed)

    def summary(self):
        """Compact provenance for logs; omits the per-site baseline tables."""
        return {'detector': DETECTOR_ID, 'calibration_sha256': self.sha256,
                'z_threshold': self.z_threshold, 'min_extreme_tests': self.min_extreme_tests,
                'first_scan_devices': self.first_scan, 'scan_interval_devices': self.interval,
                'fisher_alpha': self.alpha, 'min_family_coverage': self.min_coverage,
                'families': self.families,
                'sites': sorted(self.baselines),
                'normal_max_early_bursts': {f: {str(k): v for k, v in sorted(p.items())}
                                            for f, p in sorted(self.floors.items())},
                'normal_fit_wafers': self.normal_fit_wafers}


def load_calibration(path):
    """Return (calibration or None, status); never raises for artifact faults."""
    try:
        raw = Path(path).read_bytes()
    except FileNotFoundError:
        return None, 'calibration_missing'
    except OSError:
        return None, 'calibration_unreadable'
    def reject(constant):
        raise ValueError('nonfinite JSON constant ' + constant)
    try:
        artifact = json.loads(raw.decode('utf-8'), parse_constant=reject)
        return BurstCalibration(artifact, hashlib.sha256(raw).hexdigest()), 'active'
    except (ValueError, TypeError, AttributeError, UnicodeDecodeError) as exc:
        return None, 'calibration_invalid: ' + str(exc)[:200]


class SparseBurstSpreadDown:
    """Per-wafer supplementary spread-down evidence from sparse extreme bursts."""

    def __init__(self, calibration=None, status=None):
        self.calibration = calibration if isinstance(calibration, BurstCalibration) else None
        self.status = 'active' if self.calibration else (status if status and status != 'active'
                                                          else 'calibration_missing')
        self.completed = 0
        self.devices = []
        self.unknown_site_devices = 0
        self.last_scan = 0
        self.emitted = False
        self.scans = []

    def add(self, site, values, device=None):
        """Record one completed device; only artifact-listed tests are scored."""
        self.completed += 1
        site = str(site)
        extreme, present = {}, Counter()
        calibration = self.calibration
        if calibration is not None:
            table = calibration.baselines.get(site)
            if table is None:
                self.unknown_site_devices += 1
            else:
                limit, families = calibration.z_threshold, calibration.test_family
                for test, value in values.items():
                    reference = table.get(test)
                    if reference is None:
                        continue
                    try:
                        value = float(value)
                    except (TypeError, ValueError):
                        continue
                    if not math.isfinite(value):
                        continue
                    family = families[test]
                    present[family] += 1
                    z = abs(value - reference[0]) / reference[1]
                    if z > limit:
                        extreme.setdefault(family, []).append((test, value, reference[0], reference[1], z))
        self.devices.append((site, None if device is None else str(device), extreme, present))

    def coverage(self, index, family):
        """Fraction of the site's calibrated family tests present and finite."""
        site, _, _, present = self.devices[index]
        expected = self.calibration.site_family_tests.get(site, {}).get(family, 0) if self.calibration else 0
        return present[family] / expected if expected else 0.

    def burst_flags(self, family, completed=None):
        count = self.completed if completed is None else completed
        need = self.calibration.min_extreme_tests if self.calibration else math.inf
        return [len(extreme.get(family, ())) >= need for _, _, extreme, _ in self.devices[:count]]

    def window(self, family, completed):
        """Equal early/recent halves of the completed prefix for one family."""
        flags = self.burst_flags(family, completed)
        half = completed // 2
        early, recent = sum(flags[:half]), sum(flags[half:completed])
        early_n, recent_n = half, completed - half
        early_rate, recent_rate = early / early_n, recent / recent_n
        return {'family': family, 'completed_devices': completed,
                'early_devices': early_n, 'recent_devices': recent_n,
                'early_burst_count': early, 'recent_burst_count': recent,
                'early_burst_rate': early_rate, 'recent_burst_rate': recent_rate,
                'rate_difference': early_rate - recent_rate,
                'rate_ratio': early_rate / recent_rate if recent else None,
                'rate_ratio_haldane': ((early + .5) / (early_n + 1)) / ((recent + .5) / (recent_n + 1)),
                'fisher_p': fisher_early_greater(early, early_n, recent, recent_n),
                'low_coverage_devices': sum(self.coverage(i, family) < self.calibration.min_coverage
                                            for i in range(completed))}

    def _scan(self, family, completed):
        scan = self.window(family, completed)
        floor = self.calibration.floor(family, completed)
        scan['normal_max_early_bursts'] = floor
        if floor is None:
            reason = 'no_normal_floor_for_position'
        elif scan['low_coverage_devices']:
            reason = 'insufficient_family_coverage'
        elif scan['early_burst_count'] <= floor:
            reason = 'early_not_above_normal_floor'
        elif scan['early_burst_count'] <= scan['recent_burst_count']:
            reason = 'early_not_above_recent'
        elif scan['fisher_p'] > self.calibration.alpha:
            reason = 'fisher_p_above_alpha'
        else:
            reason = 'passed'
        scan['passed'] = reason == 'passed'
        scan['reason'] = reason
        return scan

    def analyze(self, final=False):
        """Scan only at artifact cadence; final=True cannot add a scan position."""
        calibration, completed = self.calibration, self.completed
        if calibration is None or completed == self.last_scan or completed < calibration.first_scan \
                or (completed - calibration.first_scan) % calibration.interval:
            return []
        self.last_scan = completed
        scans = [self._scan(family, completed) for family in calibration.families]
        self.scans.append({'completed_devices': completed, 'unknown_site_devices': self.unknown_site_devices,
                           'families': scans})
        passing = [scan for scan in scans if scan['passed']]
        if self.emitted or not passing:
            return []
        self.emitted = True
        best = min(passing, key=lambda s: (s['normal_max_early_bursts'] - s['early_burst_count'],
                                           s['fisher_p'], s['family']))
        return [self._alert(best, passing)]

    def _alert(self, scan, passing):
        calibration = self.calibration
        family, completed, half = scan['family'], scan['completed_devices'], scan['early_devices']
        need = calibration.min_extreme_tests
        bursts, early_tests = [], Counter()
        series, site_series = [], {}
        for index, (site, device, extreme, _) in enumerate(self.devices[:completed]):
            items = extreme.get(family, ())
            series.append(len(items))
            site_series.setdefault(site, []).append(len(items))
            if len(items) < need:
                continue
            window = 'early' if index < half else 'recent'
            if window == 'early':
                early_tests.update(item[0] for item in items)
            ordered = sorted(items, key=lambda item: (-item[4], item[0]))
            bursts.append({'device_index': index + 1, 'window': window, 'site': site, 'device_id': device,
                           'extreme_test_count': len(items),
                           'tests': [{'test': test, 'value': value, 'baseline_median': median,
                                      'baseline_scale': scale, 'robust_z': _finite_json(z)}
                                     for test, value, median, scale, z in ordered[:MAX_EVIDENCE_TESTS]],
                           'tests_truncated': max(0, len(items) - MAX_EVIDENCE_TESTS)})
        test = min(early_tests, key=lambda name: (-early_tests[name], name))
        early_sites = Counter(b['site'] for b in bursts if b['window'] == 'early')
        message = ('{}: sparse extreme-result bursts fell from {}/{} early to {}/{} recent devices '
                   '(normal-fit early max {}, one-sided Fisher p={:.3f})').format(
                       family, scan['early_burst_count'], scan['early_devices'], scan['recent_burst_count'],
                       scan['recent_devices'], scan['normal_max_early_bursts'], scan['fisher_p'])
        evidence = dict(scan)
        evidence.update({'z_threshold': calibration.z_threshold, 'min_extreme_tests': need,
                         'fisher_alpha': calibration.alpha, 'min_family_coverage': calibration.min_coverage,
                         'early_burst_sites': dict(sorted(early_sites.items())),
                         'burst_devices': bursts, 'calibration_sha256': calibration.sha256,
                         'other_passing_families': [dict(s) for s in passing if s is not scan]})
        return {'kind': 'spread_down', 'detector': DETECTOR_ID, 'detector_role': 'supplementary',
                'score': scan['early_burst_count'] / (scan['normal_max_early_bursts'] + 1),
                'test': test, 'family': family, 'message': message,
                'observed': scan['recent_burst_rate'], 'reference': scan['early_burst_rate'],
                'series': series[-MAX_SERIES:], 'site': 'all',
                'site_series': {site: values[-MAX_SERIES:] for site, values in sorted(site_series.items())},
                'completed_devices': completed, 'baseline': None, 'suggestion': SUGGESTION,
                'burst_evidence': evidence}
