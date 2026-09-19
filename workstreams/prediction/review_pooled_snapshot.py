"""Run B-authored controls against a byte-frozen, read-only C source snapshot.

Defaults: C workstreams/detection/pooled_candidate.py; B round3 output.
No C imports, writes, calibration outputs or claimed validation on new wafers.
"""
import argparse
import copy
import json
import math
from pathlib import Path
import types

from workstreams.prediction.spread_audit import OWNED, ROOT, digest, output_directory, write_json


def run(source, output):
    output = output_directory(output)
    raw = Path(source).read_bytes()
    output.mkdir(parents=True, exist_ok=True)
    snapshot = output / ('c-source-' + digest(raw) + '.txt')
    if OWNED not in snapshot.resolve().parents:
        raise ValueError('Snapshot output escapes workstream')
    snapshot.write_bytes(raw)
    module = types.ModuleType('b_readonly_c_snapshot')
    exec(compile(raw, str(source), 'exec'), module.__dict__)
    tests = ['%d_Main.control.Test%d#CP' % (i, i) for i in range(24)]
    config = {'window_per_site': 20, 'minimum_per_site': 8, 'scan_interval': 8,
              'minimum_family_tests': 20, 'family_quantile': .95,
              'minimum_valid_fraction': .95, 'minimum_hits': 3,
              'persistence_scans': 2, 'normal_margin': 1.2,
              'minimum_log_drop': math.log(2), 'sd_floor_fraction': .1}
    calibration = {'config': config, 'sites': ['1', '2', '3', '4'],
                   'families': {'Main.control': tests}, 'baseline_sd': dict.fromkeys(tests, 2.),
                   'thresholds': {'Main.control': math.log(2)}, 'calibration_sha256': 'B_SYNTHETIC_CONTROL_ONLY'}
    def replay(mode, length=160):
        detector = module.PooledSpreadDecrease(copy.deepcopy(calibration))
        alerts, scans, failure = [], [], None
        try:
            for n in range(length):
                site = str(n % 4 + 1); sample = n // 4
                value = (-1. if sample % 2 == 0 else 1.) * 2.
                if mode == 'reduced' and sample >= 10:
                    value *= .05
                if mode == 'constant_mean_offset':
                    value += 100.
                if mode == 'site_offsets':
                    value += 100. * int(site)
                if mode == 'mean_step' and sample >= 10:
                    value += 100.
                if mode == 'single_impulse' and n == 0:
                    value = 100.
                if mode == 'large_finite':
                    value *= 1e200
                values = dict.fromkeys(tests, value)
                if mode == 'missing_site' and site == '4':
                    values = {}
                if mode == 'nonfinite_site' and site == '4':
                    values = dict.fromkeys(tests, float('nan'))
                if mode == 'metadata':
                    values.update(wafer=25, label='spread_down', future=1e200, SBin=99)
                detector.add(site, values)
                alerts.extend(detector.analyze())
                scans.extend(copy.deepcopy(detector.latest_scans))
            final = detector.analyze(True)
            repeat = detector.analyze(True)
        except Exception as exc:
            failure = {'type': type(exc).__name__, 'message': str(exc), 'completed_devices': detector.completed}
            final, repeat = [], []
        return {'mode': mode, 'devices': length, 'alerts': alerts, 'scans': scans,
                'exception': failure, 'final_extra_alerts': final + repeat, 'bound': detector.state_bound()}
    records = {mode: replay(mode) for mode in ('no_change', 'reduced', 'constant_mean_offset',
               'site_offsets', 'mean_step', 'single_impulse', 'missing_site', 'nonfinite_site',
               'metadata', 'large_finite')}
    short = replay('reduced', 72)
    checks = {
        'no_change_no_alert': not records['no_change']['alerts'],
        'reduction_detected': bool(records['reduced']['alerts']),
        'constant_mean_offset_no_alert': not records['constant_mean_offset']['alerts'],
        'site_offsets_no_alert': not records['site_offsets']['alerts'],
        'mean_step_no_spread_alert': not records['mean_step']['alerts'],
        'single_impulse_no_persistent_spread_alert': not records['single_impulse']['alerts'],
        'missing_site_abstains': not records['missing_site']['alerts'],
        'nonfinite_site_abstains': not records['nonfinite_site']['alerts'],
        'metadata_cannot_change_results': records['metadata']['alerts'] == records['no_change']['alerts'] and records['metadata']['scans'] == records['no_change']['scans'],
        'finalization_cannot_supply_second_vote': not short['alerts'] and not short['final_extra_alerts'],
        'bounded_after_160_devices': all(r['bound']['retained_measurement_slots'] <= 24 * 4 * 20 for r in records.values()),
        'finite_extremes_do_not_raise': records['large_finite']['exception'] is None,
        'no_normal_control_exceptions': all(r['exception'] is None for mode, r in records.items() if mode != 'large_finite'),
    }
    report = {'source': str(Path(source).resolve()), 'source_sha256': digest(raw),
              'preserved_source_snapshot': str(snapshot.relative_to(ROOT)),
              'source_unchanged_during_check': digest(Path(source).read_bytes()) == digest(raw),
              'reviewer_sha256': digest(Path(__file__).read_bytes()),
              'calibration': calibration, 'checks': checks, 'records': records, 'short_finalization': short,
              'fixture': '24 identical synthetic tests; four sites; +/-2 noise alternating per-site; step adds100 after site sample10, reduction scales by0.05 after sample10;160devices',
              'limits': ['Synthetic behavior audit of this exact source SHA only; C may still be editing.',
                         'Correlated tests intentionally expose family-vote dependence; not independent samples.',
                         'No calibration/wafer generalization or live SDK acceptance.']}
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'c-snapshot-controls.json', report)
    print(json.dumps({'source_sha256': report['source_sha256'], 'checks': checks,
                      'alerts': {k: [(a['kind'], a['completed_devices']) for a in v['alerts']] for k, v in records.items()},
                      'exceptions': {k: v['exception'] for k, v in records.items() if v['exception']}}, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'workstreams/detection/pooled_candidate.py')
    parser.add_argument('--output', default=str(OWNED / 'round3'))
    args = parser.parse_args()
    run(args.source, args.output)


if __name__ == '__main__':
    main()
