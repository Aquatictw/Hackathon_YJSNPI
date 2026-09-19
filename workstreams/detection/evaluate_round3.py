"""R3 local-only all-wafer evaluation and synthetic controls.

Defaults: source_review/training/Data/*_RawResult.csv,
grp6_app/artifacts/runtime.json and retained evidence/baseline/summary.json.
--output defaults to workstreams/detection/round3/evaluation.json; only JSON
paths inside round3 are allowed after symlink resolution. Existing output is
refused. One adjacent *.calibration.json is written with the frozen fit.
Runtime receives neither wafer labels nor future devices. No network or Git writes.
"""
import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys
import time

from grp6_app.rehearse import EXPECTED
from grp6_app.runtime import WaferDetector
from .pooled_candidate import CONFIG, PooledSpreadDecrease, family_of, quantile, variance
from .profile_detector import canonical, digest, read_wafer, retained_state, timings, value_digest
from .synthetic_round3 import controls

ROOT = Path(__file__).resolve().parents[2]
OWNED = ROOT / 'workstreams/detection'
BASE = '810b4ac9549a619ab09e9145f656c363c6d75035'


def output_path(value):
    path = Path(value).resolve()
    owned, allowed = OWNED.resolve(), (OWNED / 'round3').resolve()
    if owned not in allowed.parents or allowed not in path.parents or path.suffix != '.json':
        raise ValueError('Output must be JSON under workstreams/detection/round3')
    return path


def relative(path):
    return Path(path).relative_to(ROOT).as_posix()


def mutable_bytes(detector):
    seen = set()
    def size(v):
        if id(v) in seen:
            return 0
        seen.add(id(v))
        n = sys.getsizeof(v)
        if isinstance(v, dict):
            n += sum(size(k) + size(x) for k, x in v.items())
        elif isinstance(v, (tuple, list, set, deque)):
            n += sum(size(x) for x in v)
        return n
    return size({k: v for k, v in vars(detector).items()
                 if k not in ('config', 'sites', 'families', 'baseline_sd', 'thresholds', 'calibration_sha256')})


def fit(artifact, files):
    normal = artifact['detector_calibration']['normal_fit_wafers']
    families = {}
    for test, base in artifact['baselines'].items():
        if base['sd'] > 0 and math.isfinite(base['sd']):
            families.setdefault(family_of(test), []).append(test)
    families = {f: ts for f, ts in families.items() if len(ts) >= CONFIG['minimum_family_tests']}
    first_wafer, rows = read_wafer(files[0])
    sites = sorted({s for s, _, _ in rows})
    calibration = {'config': CONFIG, 'sites': sites, 'families': families,
                   'baseline_sd': {t: artifact['baselines'][t]['sd'] for ts in families.values() for t in ts},
                   'thresholds': dict.fromkeys(families, CONFIG['minimum_log_drop']),
                   'calibration_sha256': 'fit-in-progress', 'normal_fit_wafers': normal,
                   'fit_policy': 'max normal-fit eligible prefix statistic times1.2, floor log(2); fixed online configuration selected on reused development wafers'}
    maxima = dict.fromkeys(families, 0.)
    witnesses = {}
    fit_scans = []
    for path in files:
        wafer, rows = read_wafer(path)
        if wafer not in normal:
            continue
        detector = PooledSpreadDecrease(calibration)
        for site, values, _ in rows:
            detector.add(site, values)
            detector.analyze()
            for scan in detector.latest_scans:
                fit_scans.append({'wafer': wafer, **scan})
                f = scan['family']
                if scan['statistic'] > maxima[f]:
                    maxima[f] = scan['statistic']
                    witnesses[f] = {'wafer': wafer, 'completed_devices': detector.completed}
    calibration['thresholds'] = {f: max(CONFIG['minimum_log_drop'], v * CONFIG['normal_margin'])
                                 for f, v in maxima.items()}
    calibration['normal_maxima'] = maxima
    calibration['normal_maximum_witnesses'] = witnesses
    del calibration['calibration_sha256']
    calibration['calibration_sha256'] = value_digest(calibration)
    return calibration, fit_scans


def core_diagnostic(detector):
    """Independent read-only reproduction of current core spread-down family gate."""
    metrics, hits = {}, {}
    for name, by_site in detector.site_values.items():
        logs = []
        base = detector.baselines[name]
        floor = max(base['sd'], 1e-9) * .1
        for seq in by_site.values():
            if len(seq) < 6:
                continue
            half = len(seq) // 2
            a, b = seq[:half], seq[-half:]
            ma, mb = sum(a) / len(a), sum(b) / len(b)
            sa = math.sqrt(sum((v-ma)**2 for v in a)/len(a))
            sb = math.sqrt(sum((v-mb)**2 for v in b)/len(b))
            logs.append(math.log(max(sa, floor) / max(sb, floor)))
        if not logs:
            continue
        family = family_of(name)
        metrics.setdefault(family, []).append(sum(logs) / len(logs))
        hits[family] = hits.get(family, 0) + int(max(logs) > base.get('thresholds', {}).get('spread_down', math.log(2.5)))
    return [{'family': f, 'completed_devices': detector.completed, 'tests': len(v),
             'core_q80': quantile(v, .8), 'threshold': detector.family_thresholds[f][3],
             'score': quantile(v, .8) / max(detector.family_thresholds[f][3], .1),
             'individual_tests_with_site_exceedance': hits[f],
             'core_streak': detector.family_streak.get((f, 3), 0)}
            for f, v in metrics.items() if f in detector.family_thresholds]


def key(alert):
    return {k: alert[k] for k in ('kind', 'completed_devices', 'test', 'site')}


def run(output):
    artifact_path = ROOT / 'grp6_app/artifacts/runtime.json'
    oracle_path = OWNED / 'evidence/baseline/summary.json'
    files = sorted((ROOT / 'source_review/training/Data').glob('*_RawResult.csv'))
    source_paths = [ROOT / p for p in ('grp6_app/runtime.py', 'grp6_app/rehearse.py',
                    'workstreams/detection/pooled_candidate.py', 'workstreams/detection/evaluate_round3.py',
                    'workstreams/detection/synthetic_round3.py', 'workstreams/detection/profile_detector.py')]
    inputs = {relative(p): digest(p) for p in [artifact_path, oracle_path, *files, *source_paths]}
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    artifact = json.loads(artifact_path.read_text(encoding='utf-8'))
    historical = {r['wafer']: r for r in json.loads(oracle_path.read_text())['wafers']}
    started = datetime.now(timezone.utc).isoformat()
    calibration, fit_scans = fit(artifact, files)
    all_results, normal_extra, added_count, preserved_count = [], [], 0, 0
    all_samples = {v: {p: [] for p in ('constructor', 'add', 'active_scan', 'scheduled_scan', 'skipped_scan', 'final')} for v in ('baseline', 'candidate')}
    for ordinal, path in enumerate(files):
        wafer, rows = read_wafer(path)
        begin = time.perf_counter_ns()
        core = WaferDetector(artifact['baselines'], artifact['family_thresholds'])
        middle = time.perf_counter_ns()
        candidate = PooledSpreadDecrease(calibration)
        finish = time.perf_counter_ns()
        samples = {v: {p: [] for p in all_samples[v]} for v in all_samples}
        samples['baseline']['constructor'] = [(middle-begin)/1e6]
        samples['candidate']['constructor'] = [(finish-middle)/1e6]
        baseline, additions, raw, suppressed, scans, diagnostic = [], [], [], [], [], []
        for site, values, passed in rows:
            emitted = {}
            # Alternate operation order by wafer; no paired speedup claim.
            for name in (('baseline', 'candidate') if ordinal % 2 == 0 else ('candidate', 'baseline')):
                detector = core if name == 'baseline' else candidate
                t0 = time.perf_counter_ns()
                if name == 'baseline':
                    detector.add(site, values, passed)
                else:
                    detector.add(site, values)
                t1 = time.perf_counter_ns()
                emitted[name] = detector.analyze()
                t2 = time.perf_counter_ns()
                samples[name]['add'].append((t1-t0)/1e6)
                phase = 'scheduled_scan' if detector.completed % 8 == 0 else 'skipped_scan'
                samples[name][phase].append((t2-t1)/1e6)
                if detector.completed % 8 == 0 and detector.completed >= 32:
                    samples[name]['active_scan'].append((t2-t1)/1e6)
            baseline.extend(emitted['baseline'])
            raw.extend(emitted['candidate'])
            additions.extend(emitted['candidate'])
            scans.extend(candidate.latest_scans)
            if wafer == 25 and core.completed >= 32 and core.completed % 8 == 0:
                diagnostic.extend(core_diagnostic(core))
        for name, detector in [('baseline', core), ('candidate', candidate)]:
            t0 = time.perf_counter_ns()
            final = detector.analyze(final=True)
            samples[name]['final'].append((time.perf_counter_ns()-t0)/1e6)
            if name == 'baseline':
                baseline.extend(final)
            elif final:
                raise AssertionError('Unexpected duplicate final candidate vote')
        if canonical(baseline) != canonical(historical[wafer]['alerts']):
            raise AssertionError('Baseline changed versus historical exact oracle W' + str(wafer))
        expected = EXPECTED.get(wafer, 'normal')
        combined = sorted(baseline + additions, key=lambda a: a['completed_devices'])
        first = next((a['completed_devices'] for a in combined if a['kind'] == expected), None)
        if additions and expected == 'normal':
            normal_extra.append(wafer)
        added_count += len(additions)
        preserved_count += len(baseline)
        all_results.append({'wafer': wafer, 'data': relative(path), 'devices': len(rows),
            'yield': sum(p for _, _, p in rows) / len(rows), 'expected': expected,
            'expected_first_device': first, 'baseline_alerts': baseline,
            'candidate_raw_alerts': raw, 'suppressed_candidate_alerts': suppressed,
            'added_alerts': additions, 'removed_alerts': [], 'combined_alerts': combined,
            'baseline_exact_oracle_equal': True, 'candidate_scans': scans,
            'w25_core_diagnostic': diagnostic, 'samples_ms': samples,
            'state': {'baseline': retained_state(core),
                      'candidate': {**candidate.state_bound(), 'reachable_mutable_bytes': mutable_bytes(candidate)}}})
        for v in all_samples:
            for phase, values_ in samples[v].items():
                all_samples[v][phase].extend(values_)
        print('W%02d: baseline=%d additions=%s expected=%s at=%s' % (wafer, len(baseline),
              [a['completed_devices'] for a in additions], expected, first), flush=True)
    if len(all_results) != 25 or {r['wafer'] for r in all_results} != set(range(1,26)) or sum(r['devices'] for r in all_results) != 2000:
        raise AssertionError('Incomplete all25/2000 corpus')
    synthetic = controls()
    if any(digest(ROOT / p) != h for p, h in inputs.items()):
        raise AssertionError('Input/source bytes changed during evaluation')
    report = {'round': 'R3-20260919', 'assigned_base': BASE, 'observed_head': head,
        'started_utc': started, 'finished_utc': datetime.now(timezone.utc).isoformat(),
        'environment': {'python': sys.version, 'platform': platform.platform()},
        'source_and_input_sha256': inputs, 'inputs_unchanged_after_run': True,
        'calibration': calibration, 'fit_scans': fit_scans,
        'composition': 'Preserve every core alert byte-for-byte. Keep every candidate alert as separately identified supplementary evidence. Candidate emitted state never touches core emitted state. W14/W18 have same-scan overlapping categories; W23 has earlier supplementary and later original spread_down.',
        'summary': {'wafers': len(all_results), 'devices': 2000, 'expected_categories_detected': sum(r['expected_first_device'] is not None for r in all_results),
                    'expected_anomaly_wafers': len(EXPECTED), 'baseline_alerts_preserved': preserved_count,
                    'added_alerts': added_count, 'removed_alerts': 0, 'additional_normal_label_wafers': normal_extra,
                    'synthetic_expectation_failures': synthetic['expectation_failures']},
        'timing': {v: {p: timings(s) for p, s in phases.items()} for v, phases in all_samples.items()},
        'timing_method': 'One measured traversal/wafer after normal-fit work; alternating core/candidate order by filename ordinal; parsing/hash/diagnostics/state traversal excluded. Active>=32. Raw samples retained. Development workstation, no SDK/deadline or repeatable speedup claim.',
        'synthetic': synthetic, 'wafers': all_results,
        'limitations': ['All25 reused development data; q95/window/floor chosen after inspecting W25; no holdout.',
                       'Normal-fit thresholds reuse13 evaluation wafers; published baseline scales inherit existing artifact provenance; no independent specificity estimate.',
                       'Expected labels provide category coverage, not complete per-test truth; extra categories unadjudicated.',
                       'W25 first emission at final device80; subsequent tester message retrieval unverified.',
                       'Bound is sidecar only; core retains unbounded device histories.',
                       'Source units, Edge latency, SDK deadline and live tester delivery unverified.']}
    output.parent.mkdir(parents=True, exist_ok=True)
    calibration_path = output.with_name(output.stem + '.calibration.json')
    for path, data in [(output, report), (calibration_path, calibration)]:
        with path.open('x', encoding='utf-8') as handle:
            handle.write(json.dumps(data, indent=2, allow_nan=False) + '\n')
    print(json.dumps(report['summary'], indent=2), flush=True)
    print('synthetic:', json.dumps(synthetic['by_mode']), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(OWNED / 'round3/evaluation.json'))
    args = parser.parse_args()
    output = output_path(args.output)
    if output.exists() or output.with_name(output.stem + '.calibration.json').exists():
        raise ValueError('Refusing to overwrite evidence; choose a fresh output stem')
    run(output)


if __name__ == '__main__':
    main()
