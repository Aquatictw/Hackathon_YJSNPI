"""R2 offline detector profile; no SDK connection or runtime modification.

Defaults: source_review/training/Data/*_RawResult.csv and
grp6_app/artifacts/runtime.json in this checkout. One warmup and four measured
repetitions of BOTH detectors per wafer, with alternating execution order.
Output must be JSON under workstreams/detection/round2 (symlinks resolved).
CSV parsing, equivalence checks, retained-size traversal and JSON I/O are untimed.
"""
import argparse
import csv
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time

from grp6_app.rehearse import EXPECTED
from grp6_app.runtime import WaferDetector

ROOT = Path(__file__).resolve().parents[2]
OWNED = ROOT / 'workstreams/detection'
BASE_SHA = 'a0d43172bbbdbde75fa1185d8037d4a35b787d4c'
ROUND = 'R2-20260919'


class SiteKeyDetector(WaferDetector):
    """One candidate: reuse str(site) for finite inputs within each device.

    analyze and all arithmetic are inherited unchanged. Site identity must be a
    stable integer/string; custom stateful __str__ objects are outside this claim.
    """

    def add(self, site, values, passed):
        self.completed += 1
        if passed:
            self.good += 1
        self.yield_series.append(self.good / self.completed)
        site_key = None
        for name, value in values.items():
            if name in self.baselines and math.isfinite(value):
                self.values[name].append(value)
                if site_key is None:
                    site_key = str(site)
                self.site_values[name][site_key].append(value)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(value):
    # No rounding or tolerance; sorted mapping keys, preserved list/callback order.
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def value_digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def timings(samples):
    if not samples:
        return {'n': 0, 'p50_ms': None, 'p95_ms': None, 'max_ms': None, 'sum_ms': 0.0}
    ordered = sorted(samples)
    pos = .95 * (len(ordered) - 1)
    i = int(pos)
    return {'n': len(samples), 'p50_ms': statistics.median(samples),
            'p95_ms': ordered[i] + (ordered[min(i + 1, len(ordered) - 1)] - ordered[i]) * (pos - i),
            'max_ms': max(samples), 'sum_ms': sum(samples)}


def output_path(value):
    path = Path(value).resolve()
    allowed = (OWNED / 'round2').resolve()
    if OWNED.resolve() not in allowed.parents or allowed not in path.parents or path.suffix != '.json':
        raise ValueError('Output must be a JSON file under workstreams/detection/round2')
    return path


def read_wafer(path):
    rows = []
    with Path(path).open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.reader(handle)
        header = next(reader)
        for _ in range(4):
            next(reader)
        wafers = set()
        for row in reader:
            if not row or not row[0].isdigit():
                continue
            meta = dict(zip(header[:10], row[:10]))
            wafers.add(int(meta['Wafer']))
            values = {name: float(value) for name, value in zip(header[10:], row[10:]) if value.strip()}
            rows.append((meta['Site'], values, meta['SBin'] == '1'))
    if len(wafers) != 1 or not rows:
        raise ValueError('Expected one nonempty wafer per CSV: ' + str(path))
    return wafers.pop(), rows


def mutable_state(detector):
    return {name: value for name, value in vars(detector).items()
            if name not in ('baselines', 'family_thresholds')}


def state_digest(detector):
    state = mutable_state(detector)
    state['emitted'] = sorted(state['emitted'])
    state['family_streak'] = sorted((family, index, count)
                                     for (family, index), count in state['family_streak'].items())
    return value_digest(state)


def retained_state(detector):
    """Reachable mutable end-wafer estimate, not RSS/peak allocation.

    Shared baselines and family thresholds are excluded. Float/key objects shared
    with the input are counted once if reachable here. Scan temporaries and
    external retained alerts are excluded.
    """
    seen = set()

    def size(value):
        if id(value) in seen:
            return 0
        seen.add(id(value))
        total = sys.getsizeof(value)
        if isinstance(value, dict):
            total += sum(size(k) + size(v) for k, v in value.items())
        elif isinstance(value, (list, tuple, set)):
            total += sum(size(v) for v in value)
        return total

    values = detector.values
    site_values = detector.site_values
    return {'completed_devices': detector.completed, 'test_series': len(values),
            'global_sample_references': sum(map(len, values.values())),
            'site_sample_references': sum(len(seq) for sites in site_values.values() for seq in sites.values()),
            'max_global_series_length': max(map(len, values.values()), default=0),
            'max_site_series_length': max((len(seq) for sites in site_values.values() for seq in sites.values()), default=0),
            'test_site_series': sum(map(len, site_values.values())),
            'yield_samples': len(detector.yield_series),
            'family_streak_entries': len(detector.family_streak), 'emitted_categories': len(detector.emitted),
            'reachable_mutable_state_bytes': size(mutable_state(detector))}


def run_once(detector_type, artifact, rows):
    samples = {name: [] for name in ('constructor', 'ingestion', 'scheduled_scan',
               'active_scan', 'warmup_scan', 'skipped_scan', 'device_total', 'finalization', 'wafer_total')}
    trace = []
    total_start = time.perf_counter_ns()
    start = time.perf_counter_ns()
    detector = detector_type(artifact['baselines'], artifact.get('family_thresholds'))
    samples['constructor'].append((time.perf_counter_ns() - start) / 1e6)
    for site, values, passed in rows:
        device_start = time.perf_counter_ns()
        detector.add(site, values, passed)
        added = time.perf_counter_ns()
        alerts = detector.analyze()
        analyzed = time.perf_counter_ns()
        samples['ingestion'].append((added - device_start) / 1e6)
        duration = (analyzed - added) / 1e6
        if detector.completed % 8 == 0:
            samples['scheduled_scan'].append(duration)
            samples['active_scan' if detector.completed >= 24 else 'warmup_scan'].append(duration)
        else:
            samples['skipped_scan'].append(duration)
        samples['device_total'].append((analyzed - device_start) / 1e6)
        trace.append({'completed_devices': detector.completed, 'final': False, 'alerts': alerts})
    final_was_scan = detector.completed != detector.last_analyzed
    start = time.perf_counter_ns()
    final_alerts = detector.analyze(final=True)
    samples['finalization'].append((time.perf_counter_ns() - start) / 1e6)
    samples['wafer_total'].append((time.perf_counter_ns() - total_start) / 1e6)
    trace.append({'completed_devices': detector.completed, 'final': True, 'alerts': final_alerts})
    return {'samples_ms': samples, 'trace': trace, 'state_sha256': state_digest(detector),
            'retained': retained_state(detector), 'finalization_performed_scan': final_was_scan}


def compare_runs(baseline, candidate):
    if canonical(baseline['trace']) != canonical(candidate['trace']):
        raise AssertionError('Exact per-callback alert evidence differs')
    if baseline['state_sha256'] != candidate['state_sha256']:
        raise AssertionError('Final detector state differs')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def run(output, warmup=1, repetitions=4):
    output = output_path(output)
    if warmup < 1 or repetitions < 2:
        raise ValueError('Require at least one warmup and two measured repetitions')
    sources = sorted((ROOT / 'source_review/training/Data').glob('*_RawResult.csv'))
    if len(sources) != 25:
        raise ValueError('Acceptance requires exactly 25 CSVs')
    artifact_path = ROOT / 'grp6_app/artifacts/runtime.json'
    historical_path = OWNED / 'evidence/baseline/summary.json'
    inputs = sources + [artifact_path, ROOT / 'grp6_app/runtime.py', ROOT / 'grp6_app/rehearse.py', historical_path]
    hashes = {path.relative_to(ROOT).as_posix(): digest(path) for path in inputs}
    artifact = json.loads(artifact_path.read_text(encoding='utf-8'))
    historical = {row['wafer']: row for row in json.loads(historical_path.read_text(encoding='utf-8'))['wafers']}
    code = {path.relative_to(ROOT).as_posix(): digest(path) for path in
            [Path(__file__), OWNED / 'test_profile.py']}
    totals = {'baseline': {}, 'candidate': {}}
    entries = []
    for ordinal, path in enumerate(sources):
        wafer, rows = read_wafer(path)
        reference = None
        runs = []
        for iteration in range(warmup + repetitions):
            order = ['baseline', 'candidate'] if (ordinal + iteration) % 2 == 0 else ['candidate', 'baseline']
            pair = {}
            for variant in order:
                pair[variant] = run_once(WaferDetector if variant == 'baseline' else SiteKeyDetector, artifact, rows)
            compare_runs(pair['baseline'], pair['candidate'])
            if reference is None:
                reference = pair['baseline']
            else:
                compare_runs(reference, pair['baseline'])
            if iteration < warmup:
                continue
            runs.append({'repetition': iteration - warmup + 1, 'order': order,
                         **{variant: {key: value for key, value in result.items() if key != 'trace'}
                            for variant, result in pair.items()}})
            for variant, result in pair.items():
                for phase, samples in result['samples_ms'].items():
                    totals[variant].setdefault(phase, []).extend(samples)
        alerts = [alert for call in reference['trace'] for alert in call['alerts']]
        if canonical(alerts) != canonical(historical[wafer]['alerts']):
            raise AssertionError('Baseline differs from retained R1 alerts: W' + str(wafer))
        expected = EXPECTED.get(wafer, 'normal')
        entries.append({'wafer': wafer, 'devices': len(rows), 'yield': sum(row[2] for row in rows) / len(rows),
                        'site_representation': 'CSV string, no coercion', 'expected': expected,
                        'expected_first_device': next((a['completed_devices'] for a in alerts if a['kind'] == expected), None),
                        'alerts': alerts, 'exact_alerts_and_state_equal_all_runs': True,
                        'trace_sha256': value_digest(reference['trace']),
                        'state_sha256': reference['state_sha256'], 'retained': reference['retained'],
                        'finalization_performed_scan': reference['finalization_performed_scan'], 'runs': runs})
        print('W{:02d}: {} devices; {} alerts; exact equivalence in {} warmup + {} measured pairs'.format(
            wafer, len(rows), len(alerts), warmup, repetitions), flush=True)
    if sorted(e['wafer'] for e in entries) != list(range(1, 26)) or sum(e['devices'] for e in entries) != 2000:
        raise AssertionError('Wrong wafer/device coverage')
    unchanged = all(digest(ROOT / name) == sha for name, sha in {**hashes, **code}.items())
    if not unchanged:
        raise AssertionError('Read-only inputs or evaluated code changed during run')
    summary = {variant: {phase: timings(samples) for phase, samples in phases.items()}
               for variant, phases in totals.items()}
    paired = {}
    for phase in ('ingestion', 'active_scan', 'device_total', 'wafer_total'):
        ratios = [sum(r['candidate']['samples_ms'][phase]) / sum(r['baseline']['samples_ms'][phase])
                  for e in entries for r in e['runs']]
        paired[phase] = {'n': len(ratios), 'median_candidate_over_baseline': statistics.median(ratios),
                         'min_ratio': min(ratios), 'max_ratio': max(ratios),
                         'candidate_faster_pairs': sum(r < 1 for r in ratios)}
    report = {'schema_version': 1, 'round': ROUND, 'base_sha': BASE_SHA, 'profile_head_sha': git('rev-parse', 'HEAD'),
              'mode': 'offline desktop detector profile', 'live_integration': 'NOT TESTED',
              'created_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'input_sha256': hashes, 'code_sha256': code, 'inputs_and_code_unchanged': unchanged,
              'hash_encoding': 'raw file bytes; Git checkout CRLF conversion changes source hashes',
              'environment': {'python': sys.version, 'implementation': platform.python_implementation(),
                              'platform': platform.platform(), 'machine': platform.machine(),
                              'processor': platform.processor(), 'logical_cpus': os.cpu_count(),
                              'gc_enabled': gc.isenabled(), 'gc_threshold': list(gc.get_threshold()),
                              'clock': vars(time.get_clock_info('perf_counter')),
                              'isolation': 'No CPU pinning, priority change, GC disabling or background-load control'},
              'method': {'warmup_per_variant_per_wafer': warmup, 'measured_repetitions_per_variant_per_wafer': repetitions,
                         'order': 'Alternate baseline/candidate by wafer ordinal + repetition, including warmups',
                         'percentiles': 'p50 median; p95 linear interpolation at .95*(n-1)',
                         'inputs': 'One CSV wafer loaded at a time; device order and string sites preserved',
                         'timers': 'perf_counter_ns; no subtraction of timer overhead',
                         'device_total': 'add + analyze, including middle timer call',
                         'wafer_total': 'constructor + all add/analyze + finalization + sample/trace bookkeeping',
                         'active_scan': 'Scheduled scans at completed >=24; scheduled_scan includes 8/16 warmup scans',
                         'exclusions': 'CSV/JSON load, state/evidence checks and serialization, memory traversal, output I/O, SDK, exporter, models'},
              'candidate': {'name': 'SiteKeyDetector', 'change': 'Lazy per-device str(site) reuse in add only',
                            'analyze_inherited_unchanged': SiteKeyDetector.analyze is WaferDetector.analyze,
                            'retuning': False, 'extra_retained_state': 0},
              'equivalence': {'exact_alert_categories_positions_and_evidence': True, 'exact_final_state': True,
                              'historical_baseline_alerts_equal': True, 'wafer_count': len(entries),
                              'devices_per_repetition': 2000,
                              'expected_categories_detected': sum(e['expected_first_device'] is not None for e in entries),
                              'expected_anomaly_wafers': len(EXPECTED),
                              'W2_yield': entries[1]['yield'], 'W25_expected_first_device': entries[24]['expected_first_device']},
              'timing_summary': summary, 'paired_ratios': paired,
              'retained_state': {'observed_maxima': {key: max(e['retained'][key] for e in entries) for key in entries[0]['retained']},
                                 'bound': 'D devices, T baseline tests: <=D*T global and <=D*T site sample references, D yield samples, <=T*S site lists. No device/site/wafer-length cap enforced.',
                                 'complexity': 'Retained samples O(D*T); full scan O(D*T + T log T) at each 8-device boundary for fixed families; cumulative approximately O(T*D^2/8).',
                                 'size_limit': 'Reachable mutable end-wafer sys.getsizeof estimate; excludes frozen artifact, transient scans, external alerts and process RSS; not measured peak.'},
              'recommendation': 'DEFER runtime promotion; exact local equivalence alone does not establish meaningful callback benefit or SDK timing.',
              'limitations': ['Desktop timing cannot establish SDK callback/TP deadline compliance; units and effective deadline remain unverified.',
                              'All 25 wafers are reused development data, not independent detector validation.',
                              '80-device wafers end on a scan boundary: finalization is a no-op; residual finalization covered by synthetic tests only.',
                              'No detector memory cap; wafer lifecycle reset is outside this candidate.',
                              'Only stable integer/string sites in scope; no side-effecting site-object equivalence claim.',
                              'No runtime/artifact change, W25 fitting, remote machine run, or threshold promotion.'],
              'wafers': entries}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + chr(10), encoding='utf-8')
    print(json.dumps({'output': str(output), 'equivalence': report['equivalence'], 'paired_ratios': paired}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', default=str(OWNED / 'round2/profile.json'))
    parser.add_argument('--warmup', type=int, default=1)
    parser.add_argument('--repetitions', type=int, default=4)
    args = parser.parse_args()
    try:
        run(args.output, args.warmup, args.repetitions)
    except (ValueError, AssertionError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
