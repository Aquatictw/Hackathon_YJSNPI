"""Independent B spread diagnostics on immutable R3 inputs (development data).

Default input: 25 source_review/training/Data CSV Git blobs and the runtime
artifact/source at BASE. Output defaults to prediction/round3. No core imports,
retraining, runtime rule, candidate implementation or machine access.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import types

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OWNED = Path(__file__).resolve().parent
BASE = '810b4ac9549a619ab09e9145f656c363c6d75035'
EXPECTED = {1: 'site_imbalance', 3: 'low_yield', 9: 'low_yield',
            14: 'mean_drift_up', 18: 'mean_drift_down',
            23: 'spread_up', 25: 'spread_down'}
PREFIXES = tuple(range(32, 81, 8))


def output_directory(value):
    path = Path(value).resolve()
    if path == OWNED or OWNED not in path.parents:
        raise ValueError('Output must be a subdirectory of workstreams/prediction')
    return path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def blob(path, revision=BASE):
    return subprocess.check_output(['git', 'show', revision + ':' + path], cwd=ROOT)


def parse_export(raw):
    """Keep blank, explicit nonfinite and malformed counts separate."""
    reader = csv.reader(io.StringIO(raw.decode('utf-8-sig')))
    header = next(reader)
    if header[:10] != ['PID', 'Lot', 'Wafer', 'Site', 'X', 'Y', 'PF', 'SBin', 'HBin', 'Test Time']:
        raise ValueError('Unexpected export identity columns')
    if len(set(header)) != len(header):
        raise ValueError('Duplicate columns')
    for _ in range(4):
        next(reader)
    meta, values, quality = [], [], []
    for row in reader:
        if not row:
            continue
        if len(row) != len(header) or not row[0].isdigit():
            raise ValueError('Incomplete or invalid device row')
        meta.append(dict(zip(header[:10], row[:10])))
        nums, flags = [], []
        for raw_value in row[10:]:
            if not raw_value.strip():
                nums.append(np.nan); flags.append(1)
                continue
            try:
                value = float(raw_value)
            except ValueError:
                nums.append(np.nan); flags.append(3)
                continue
            nums.append(value if np.isfinite(value) else np.nan)
            flags.append(0 if np.isfinite(value) else 2)
        values.append(nums); quality.append(flags)
    return header[10:], meta, np.array(values), np.array(quality, dtype=np.uint8)


def moments(x):
    """Finite-only population SD; fewer than two observations is unknown."""
    finite = np.isfinite(x)
    n = finite.sum(axis=0)
    mean = np.divide(np.where(finite, x, 0).sum(axis=0), n,
                     out=np.full(x.shape[1], np.nan), where=n > 0)
    ss = np.where(finite, x - mean, 0) ** 2
    variance = np.divide(ss.sum(axis=0), n, out=np.full_like(mean, np.nan), where=n >= 2)
    return n, mean, np.sqrt(variance)


def dispersion(x, sites, count, expected_sites=('1', '2', '3', '4')):
    """Only x[:count] is visible; equal-site within SD avoids site offsets."""
    x, sites = x[:count], np.asarray(sites[:count])
    groups = {site: moments(x[sites == site]) for site in expected_sites}
    groups['pooled'] = moments(x)
    site_sd = np.array([groups[s][2] for s in expected_sites])
    # Unknown site/insufficient site data fails closed, not zero dispersion.
    within = np.sqrt(np.mean(site_sd ** 2, axis=0))
    if set(sites) - set(expected_sites):
        within[:] = np.nan
    groups['within'] = (np.min([groups[s][0] for s in expected_sites], axis=0),
                        np.mean([groups[s][1] for s in expected_sites], axis=0), within)
    return groups


def temporal_dispersion(x, sites, count, floor, expected_sites=('1', '2', '3', '4')):
    """Site early/late halves of observed prefix only; fixed artifact SD floor.

    Tuple slots are half-sample count, mean delta, last/first SD ratio.
    Odd center observations are omitted symmetrically, as in frozen runtime.
    """
    x, sites = x[:count], np.asarray(sites[:count])
    groups, first_sds, last_sds = {}, [], []
    for site in (*expected_sites, 'pooled'):
        seq = x if site == 'pooled' else x[sites == site]
        half = len(seq) // 2
        first, last = moments(seq[:half]), moments(seq[len(seq)-half:])
        ratio = np.maximum(last[2], floor) / np.maximum(first[2], floor)
        # Any missing value in a half is ineligible; no compaction across gaps.
        ratio[(first[0] != half) | (last[0] != half)] = np.nan
        groups[site] = (np.minimum(first[0], last[0]), last[1] - first[1], ratio)
        if site != 'pooled':
            first_sds.append(np.where(np.isfinite(ratio), first[2], np.nan))
            last_sds.append(np.where(np.isfinite(ratio), last[2], np.nan))
    first_within = np.sqrt(np.mean(np.array(first_sds) ** 2, axis=0))
    last_within = np.sqrt(np.mean(np.array(last_sds) ** 2, axis=0))
    ratio = np.maximum(last_within, floor) / np.maximum(first_within, floor)
    if set(sites) - set(expected_sites):
        ratio[:] = np.nan
    groups['within'] = (np.min([groups[s][0] for s in expected_sites], axis=0),
                        np.mean([groups[s][1] for s in expected_sites], axis=0), ratio)
    return groups


def reference_sd(all_stats, fit_wafers, subject, count, group):
    """Exclude subject from every reference; IDs used only by offline audit."""
    refs = [w for w in fit_wafers if w != subject]
    if not refs:
        raise ValueError('No eligible reference wafers')
    sds = np.array([all_stats[w, count][group][2] for w in refs], dtype=float)
    # Require all references finite and positive. Do not impute dispersion.
    valid = np.all(np.isfinite(sds) & (sds > 0), axis=0)
    median, minimum = np.median(sds, axis=0), np.min(sds, axis=0)
    median[~valid] = np.nan; minimum[~valid] = np.nan
    return refs, median, minimum


def family_scores(observed, reference, indices):
    ratio = np.divide(observed, reference, out=np.full_like(observed, np.nan),
                      where=np.isfinite(reference) & (reference > 0))[indices]
    valid = ratio[np.isfinite(ratio)]
    if not len(valid):
        return {'tests': len(indices), 'eligible': 0, 'q10': None, 'q20': None,
                'median': None, 'fraction_below_0_7': None}
    return {'tests': len(indices), 'eligible': len(valid),
            'q10': float(np.quantile(valid, .1)), 'q20': float(np.quantile(valid, .2)),
            'median': float(np.median(valid)), 'fraction_below_0_7': float(np.mean(valid < .7))}


def signature(alert):
    return (alert['kind'], str(alert.get('site', 'all')), alert.get('test', ''),
            alert['completed_devices'])


def acceptance_matrix():
    return {
        'round': 'R3-20260919', 'base': BASE, 'frozen_before_candidate_comparison': True,
        'data_status': 'reused development data; not independent validation',
        'gates': {
            'W25': 'spread_down by device 80; report first device, onset unknown',
            'other_labels': 'all six baseline expected categories at no later first device',
            'W2': 'retain legitimate low_yield at or before baseline device 32',
            'normal_labels': 'no added alert signature on any of all 18 normal-label wafers, including W2',
            'baseline_preservation': 'retain every baseline kind/site/test/device signature, including duplicates',
            'controls': 'no-change and mean/site-offset shift: no spread_down; reduced spread: detect; missing/nonfinite: abstain/reset',
            'causality': 'current completed-device inputs only; no ID/label feature; suffix mutation leaves earlier outputs unchanged',
        },
        'limits': ['Comparator checks all-wafer records only; candidate synthetic/causality gates require separate evidence.',
                   'No threshold search on W25 by this auditor; effect sizes are exploratory.',
                   'Extra categories on abnormal-label wafers are reported, not silently hidden.',
                   'No live delivery, units, timing, SDK, authentication or transport acceptance.'],
    }


def compare_alerts(baseline, candidate):
    """Reusable offline gate for normalized {wafers:[...]} replay summaries."""
    def index(summary):
        records = summary['wafers']
        if len(records) != 25 or {r['wafer'] for r in records} != set(range(1, 26)):
            raise ValueError('Exactly one record for each of 25 wafers required')
        for r in records:
            if r.get('devices') != 80:
                raise ValueError('Expected 80 completed devices per wafer')
            for alert in r['alerts']:
                n = alert['completed_devices']
                if type(n) is not int or not 1 <= n <= 80 or not isinstance(alert['kind'], str):
                    raise ValueError('Invalid alert timing/kind')
        return {r['wafer']: r for r in records}
    old, new = index(baseline), index(candidate)
    records = []
    for w in range(1, 26):
        before, after = old[w]['alerts'], new[w]['alerts']
        a, b = Counter(map(signature, before)), Counter(map(signature, after))
        kind = EXPECTED.get(w, 'normal')
        first = lambda alerts, k: min((v['completed_devices'] for v in alerts if v['kind'] == k), default=None)
        expected_before, expected_after = first(before, kind), first(after, kind)
        records.append({'wafer': w, 'expected': kind, 'baseline_count': len(before),
                        'candidate_count': len(after), 'baseline_first': expected_before,
                        'candidate_first': expected_after, 'removed': list((a-b).elements()),
                        'added': list((b-a).elements()),
                        'preserved_no_later': expected_after is not None and (expected_before is None or expected_after <= expected_before)})
    w2_before, w2_after = first(old[2]['alerts'], 'low_yield'), first(new[2]['alerts'], 'low_yield')
    checks = {
        'w25_spread_down': records[24]['candidate_first'] is not None,
        'other_expected_categories_no_later': all(r['preserved_no_later'] for r in records if r['wafer'] in EXPECTED and r['wafer'] != 25),
        'w2_low_yield_preserved': w2_before is not None and w2_after is not None and w2_after <= w2_before,
        'all_baseline_alerts_preserved': not any(r['removed'] for r in records),
        'all_normal_labels_no_extra_alerts': not any(r['added'] for r in records if r['wafer'] not in EXPECTED),
    }
    return {'checks': checks, 'all_wafer_gates_pass': all(checks.values()),
            'normal_label_wafers': [w for w in range(1, 26) if w not in EXPECTED],
            'wafer_results': records, 'candidate_controls_and_causality': 'NOT_EVALUATED_BY_SUMMARY_COMPARATOR',
            'promotion': 'REQUIRES_A_REVIEW_AND_SEPARATE_CONTROLS'}


def synthetic_controls():
    sites = np.tile(np.array(['1', '2', '3', '4']), 20)
    pattern = np.repeat(np.tile([-1., 1.], 10), 4)
    x = np.tile(pattern[:, None], (1, 24))
    ref = dispersion(x, sites, 80)
    reduced = dispersion(x * .25, sites, 80)
    shifted = dispersion(x + 100, sites, 80)
    offsets = np.array([0, 10, 20, 30])[np.arange(80) % 4]
    mixed = dispersion(x + offsets[:, None], sites, 80)
    missing = x.copy(); missing[sites == '4'] = np.nan
    nonfinite = x.copy(); nonfinite[sites == '4'] = np.inf
    suffix = x.copy(); suffix[40:] = 1e8
    checks = {
        'no_change_ratio_one': bool(np.all(ref['within'][2] == 1)),
        'quarter_spread_ratio': bool(np.all(reduced['within'][2] / ref['within'][2] == .25)),
        'mean_shift_preserves_sd': bool(np.all(shifted['within'][2] == ref['within'][2])),
        'site_offsets_preserve_within_sd': bool(np.all(mixed['within'][2] == ref['within'][2])),
        'site_offsets_inflate_pooled_sd': bool(np.all(mixed['pooled'][2] > 10 * ref['pooled'][2])),
        'missing_site_is_unknown': bool(np.all(np.isnan(dispersion(missing, sites, 80)['within'][2]))),
        'nonfinite_site_is_unknown': bool(np.all(np.isnan(dispersion(nonfinite, sites, 80)['within'][2]))),
        'future_suffix_does_not_change_prefix': bool(np.array_equal(dispersion(suffix, sites, 40)['within'][2], dispersion(x, sites, 40)['within'][2])),
    }
    return {'checks': checks, 'pass': all(checks.values()),
            'scope': 'B diagnostic mathematics only; does not certify any candidate detector',
            'fixture': '80 deterministic rows, four interleaved sites, 24 tests, alternating +/-1 per site'}


def write_json(path, value):
    if OWNED not in path.resolve().parents:
        raise ValueError('Output file escapes workstreams/prediction')
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def write_csv_gz(path, records, fields):
    if OWNED not in path.resolve().parents:
        raise ValueError('Output file escapes workstreams/prediction')
    with path.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader(); writer.writerows(records)


def run(output):
    output = output_directory(output)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'acceptance-matrix.json', acceptance_matrix())
    inputs = {}
    def read(path):
        raw = blob(path)
        inputs[path] = {'base_blob_sha256': digest(raw), 'bytes': len(raw),
                        'checkout_sha256': digest((ROOT / path).read_bytes())}
        return raw
    artifact = json.loads(read('grp6_app/artifacts/runtime.json'))
    runtime = read('grp6_app/runtime.py')
    saved = json.loads(read('results/replay/summary.json'))
    fit = artifact['detector_calibration']['normal_fit_wafers']
    if set(fit) & set(EXPECTED):
        raise ValueError('Anomaly-labeled reference wafer')
    datasets, all_stats, temporal_stats, baseline_records, quality_records = {}, {}, {}, [], []
    module = types.ModuleType('b_frozen_runtime')
    exec(compile(runtime, BASE + ':grp6_app/runtime.py', 'exec'), module.__dict__)
    names = None
    for w in range(1, 26):
        path = 'source_review/training/Data/A12345_W%02d_RawResult.csv' % w
        current, meta, x, quality = parse_export(read(path))
        if names is None:
            names = current
        if names != current or len(x) != 80 or {int(m['Wafer']) for m in meta} != {w}:
            raise ValueError('Unexpected wafer data shape/identity')
        floor = np.array([max(artifact['baselines'].get(n, {}).get('sd', 1e-8) * .1, 1e-12) for n in names])
        sites = np.array([r['Site'] for r in meta])
        if Counter(sites) != Counter({'1': 20, '2': 20, '3': 20, '4': 20}):
            raise ValueError('Unexpected supplied site counts')
        datasets[w] = (meta, x, quality, sites)
        for count in PREFIXES:
            all_stats[w, count] = dispersion(x, sites, count)
            temporal_stats[w, count] = temporal_dispersion(x, sites, count, floor)
        quality_records.append({'wafer': w, 'devices': len(x), 'tests': len(names),
                                'finite': int((quality == 0).sum()), 'blank': int((quality == 1).sum()),
                                'nonfinite': int((quality == 2).sum()), 'malformed': int((quality == 3).sum())})
        detector = module.WaferDetector(artifact['baselines'], artifact['family_thresholds'])
        alerts = []
        for row, values in zip(meta, x):
            detector.add(row['Site'], dict(zip(names, map(float, values))), row['SBin'] == '1')
            alerts.extend(detector.analyze())
        alerts.extend(detector.analyze(True))
        baseline_records.append({'wafer': w, 'devices': detector.completed,
                                 'yield': detector.good / detector.completed, 'alerts': alerts})
        print('W%02d: finite=%d missing=%d baseline=%s' % (w, (quality == 0).sum(),
              (quality != 0).sum(), ','.join(a['kind'] + '@' + str(a['completed_devices']) for a in alerts) or 'none'), flush=True)
    families = {}
    for i, name in enumerate(names):
        if name in artifact['baselines']:
            families.setdefault(name.split('_', 1)[1].rsplit('.', 1)[0], []).append(i)
    families = {k: v for k, v in families.items() if len(v) >= 20}
    rows, temporal_rows = [], []
    for w in range(1, 26):
        for count in PREFIXES:
            for group in ('pooled', 'within', '1', '2', '3', '4'):
                refs, median, minimum = reference_sd(all_stats, fit, w, count, group)
                observed = all_stats[w, count][group][2]
                for family, indices in families.items():
                    scores = family_scores(observed, median, indices)
                    floor_scores = family_scores(observed, minimum, indices)
                    rows.append({'wafer': w, 'completed_devices': count, 'group': group, 'family': family,
                                 'reference_wafers': len(refs), **scores,
                                 'fraction_below_min_times_0_7': floor_scores['fraction_below_0_7']})
                _, temporal_reference, _ = reference_sd(temporal_stats, fit, w, count, group)
                observed_temporal = temporal_stats[w, count][group][2]
                for family, indices in families.items():
                    scores = family_scores(observed_temporal, temporal_reference, indices)
                    raw = family_scores(observed_temporal, np.ones(len(names)), indices)
                    temporal_rows.append({'wafer': w, 'completed_devices': count, 'group': group, 'family': family,
                                          'reference_wafers': len(refs), **scores,
                                          'raw_median_last_first_sd': raw['median'],
                                          'raw_fraction_below_0_7': raw['fraction_below_0_7']})
    write_csv_gz(output / 'family-prefix.csv.gz', rows, list(rows[0]))
    write_csv_gz(output / 'temporal-prefix.csv.gz', temporal_rows, list(temporal_rows[0]))
    # Full-wafer per-test/site descriptive output, never used as prefix input.
    def test_rows():
        for w, (_, x, quality, sites) in datasets.items():
            for group in ('pooled', 'within', '1', '2', '3', '4'):
                refs, median, minimum = reference_sd(all_stats, fit, w, 80, group)
                n, mean, sd = all_stats[w, 80][group]
                _, temporal_reference, _ = reference_sd(temporal_stats, fit, w, 80, group)
                half_n, _, temporal_ratio = temporal_stats[w, 80][group]
                mask = np.ones(len(x), dtype=bool) if group in ('pooled', 'within') else sites == group
                q = quality[mask]
                for i, name in enumerate(names):
                    clean = lambda value: float(value) if np.isfinite(value) else ''
                    yield {'wafer': w, 'group': group, 'test': name, 'baseline_eligible': name in artifact['baselines'],
                           'rows': int(mask.sum()), 'n': int(n[i]), 'blank': int((q[:, i] == 1).sum()),
                           'nonfinite': int((q[:, i] == 2).sum()), 'malformed': int((q[:, i] == 3).sum()),
                           'mean': clean(mean[i]), 'sd': clean(sd[i]), 'reference_wafers': len(refs),
                           'reference_median_sd': clean(median[i]), 'reference_min_sd': clean(minimum[i]),
                           'ratio_median': clean(sd[i] / median[i]), 'ratio_min': clean(sd[i] / minimum[i]),
                           'temporal_half_n': int(half_n[i]), 'temporal_last_first_sd_ratio': clean(temporal_ratio[i]),
                           'temporal_reference_median_ratio': clean(temporal_reference[i]),
                           'temporal_ratio_to_reference': clean(temporal_ratio[i] / temporal_reference[i])}
    fields = ['wafer', 'group', 'test', 'baseline_eligible', 'rows', 'n', 'blank', 'nonfinite', 'malformed',
              'mean', 'sd', 'reference_wafers', 'reference_median_sd', 'reference_min_sd', 'ratio_median', 'ratio_min',
              'temporal_half_n', 'temporal_last_first_sd_ratio', 'temporal_reference_median_ratio', 'temporal_ratio_to_reference']
    write_csv_gz(output / 'test-site-dispersion.csv.gz', test_rows(), fields)
    baseline = {'source_revision': BASE, 'mode': 'offline_replay', 'wafers': baseline_records}
    write_json(output / 'baseline.json', baseline)
    baseline_matches = all(r['alerts'] == next(s['alerts'] for s in saved['wafers'] if s['wafer'] == r['wafer']) for r in baseline_records)
    controls = synthetic_controls()
    write_json(output / 'controls.json', controls)
    write_json(output / 'baseline-acceptance.json', compare_alerts(baseline, baseline))
    full = [r for r in rows if r['completed_devices'] == 80 and r['group'] in ('pooled', 'within')]
    diagnostics = {'base': BASE, 'status': 'EXPLORATORY_DEVELOPMENT_DIAGNOSTICS',
                   'data_quality': quality_records, 'normal_reference_wafers': fit,
                   'normal_reference_policy': 'inherited fit partition; subject excluded; same prefix; all references finite/positive',
                   'family_members': {f: len(js) for f, js in families.items()},
                   'prefix_family_records': len(rows), 'full_test_site_records': 25 * 6 * len(names),
                   'full_wafer_family_comparison': full,
                   'w25_all_prefixes': [r for r in rows if r['wafer'] == 25],
                   'w25_temporal_prefixes': [r for r in temporal_rows if r['wafer'] == 25],
                   'baseline_exactly_matches_saved_replay': baseline_matches,
                   'limitations': acceptance_matrix()['limits']}
    write_json(output / 'diagnostics.json', diagnostics)
    provenance = {'base': BASE, 'observed_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  'python': platform.python_version(), 'numpy': np.__version__, 'inputs': inputs,
                  'auditor_sha256': digest(Path(__file__).read_bytes()),
                  'outputs': {name: digest((output / name).read_bytes()) for name in (
                      'acceptance-matrix.json', 'family-prefix.csv.gz', 'temporal-prefix.csv.gz',
                      'test-site-dispersion.csv.gz', 'baseline.json', 'controls.json',
                      'baseline-acceptance.json', 'diagnostics.json')},
                  'method': 'population SD; equal-site RMS within SD; frozen normal reference medians/minima; no threshold fit or runtime changes',
                  'checks': {'25_wafers': len(datasets) == 25, 'baseline_matches_saved': baseline_matches, 'synthetic_controls': controls['pass']}}
    write_json(output / 'provenance.json', provenance)
    if not all(provenance['checks'].values()):
        raise ValueError('Audit consistency failure')
    print(json.dumps(provenance['checks']), flush=True)
    return diagnostics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(OWNED / 'round3'))
    parser.add_argument('--candidate-summary', type=Path, help='Optional normalized all-wafer summary; comparison only')
    parser.add_argument('--baseline-summary', type=Path, default=OWNED / 'round3' / 'baseline.json')
    args = parser.parse_args()
    output = output_directory(args.output)
    if args.candidate_summary:
        comparison = compare_alerts(json.loads(args.baseline_summary.read_text(encoding='utf-8')),
                                    json.loads(args.candidate_summary.read_text(encoding='utf-8')))
        output.mkdir(parents=True, exist_ok=True)
        write_json(output / 'candidate-comparison.json', comparison)
        print(json.dumps(comparison['checks']))
        # Rejected research result is evidence, not an auditor implementation error.
    else:
        run(output)


if __name__ == '__main__':
    main()
