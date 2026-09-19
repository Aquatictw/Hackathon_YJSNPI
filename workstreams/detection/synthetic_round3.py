"""Deterministic synthetic controls; no CSV labels or observations used."""
import math
import random
from .pooled_candidate import CONFIG, PooledSpreadDecrease


def calibration(tests=100):
    names = ['%d_Synthetic.family.test%d' % (j, j) for j in range(tests)]
    return {'config': dict(CONFIG), 'sites': ['1', '2', '3', '4'],
            'families': {'Synthetic.family': names},
            'baseline_sd': dict.fromkeys(names, 1.),
            'thresholds': {'Synthetic.family': math.log(2)},
            'calibration_sha256': 'synthetic-fixed-unit-scales-not-data-fit'}


def stream(mode='stable', seed=0, devices=80, tests=100):
    rng = random.Random(seed)
    names = list(calibration(tests)['baseline_sd'])
    for i in range(devices):
        site, sample = i % 4, i // 4
        values = {}
        for j, name in enumerate(names):
            scale = 1.
            if mode in ('decrease', 'missing', 'nonfinite', 'isolated_one', 'isolated_two', 'localized'):
                affected = (j < 1 if mode == 'isolated_one' else j < 2 if mode == 'isolated_two'
                            else j < 10 and site == 0 if mode == 'localized' else True)
                if affected and sample >= 10:
                    scale = .1
                elif mode == 'localized' and affected:
                    scale = 10.
            elif mode == 'increase' and sample >= 10:
                scale = 10.
            value = rng.gauss(0., scale)
            if mode == 'site_offsets':
                value += site * 100.
            if mode == 'location_step' and sample >= 6:
                value += 100.
            if mode == 'constant':
                value = float(site * 10)
            if mode == 'overflow':
                value = (1 if sample % 2 else -1) * 1e308
            if mode == 'missing' and sample >= 10:
                continue
            if mode == 'nonfinite' and sample >= 10:
                value = float('nan') if j % 2 else float('inf')
            values[name] = value
        yield str(site + 1), values


def run_stream(rows, config=None):
    detector = PooledSpreadDecrease(config or calibration())
    alerts, scans = [], []
    for site, values in rows:
        detector.add(site, values)
        alerts.extend(detector.analyze())
        scans.extend(detector.latest_scans)
    alerts.extend(detector.analyze(final=True))
    return detector, alerts, scans


def controls():
    results = []
    expected_positive = {'decrease', 'localized'}
    for mode in ('stable', 'decrease', 'increase', 'missing', 'nonfinite',
                 'site_offsets', 'location_step', 'constant', 'overflow',
                 'isolated_one', 'isolated_two', 'localized'):
        for seed in range(20):
            detector, alerts, _ = run_stream(stream(mode, seed))
            expected = mode in expected_positive
            results.append({'mode': mode, 'seed': seed, 'devices': 80,
                            'expected_alert': expected, 'observed_alert': bool(alerts),
                            'positions': [a['completed_devices'] for a in alerts],
                            'matched_expectation': bool(alerts) == expected,
                            'state': detector.state_bound()})
    return {'design': '20 fixed random.Random Gaussian seeds per control; 100 independent tests, four interleaved sites; fixed unit scales/log(2) gate; no fit on controls',
            'location_step': 'Variance remains one but mean jumps +100 after six observations/site. This adversarial control tests whether transient location change is misclassified as spread contraction.',
            'localized': 'Ten of 100 tests on site1 change SD 10 to 0.1 at observation11; other sites/tests stay unit SD.',
            'isolated': 'Only one or two of 100 tests decrease SD 1 to0.1 at observation11.',
            'results': results,
            'by_mode': {mode: {'runs': len(rs), 'alerts': sum(r['observed_alert'] for r in rs),
                              'expectation_failures': sum(not r['matched_expectation'] for r in rs)}
                        for mode in sorted({r['mode'] for r in results})
                        for rs in [[r for r in results if r['mode'] == mode]]},
            'expectation_failures': sum(not r['matched_expectation'] for r in results)}
