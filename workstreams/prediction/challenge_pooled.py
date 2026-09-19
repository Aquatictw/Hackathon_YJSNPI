"""B's independent NumPy oracle for C's proposed pooled temporal q95 statistic.

Reads immutable R3 CSV/artifact blobs. Does not import C code or use candidate
labels in scoring/calibration. Labels enter only all-wafer acceptance reporting.
Default output: workstreams/prediction/round3. All output paths are scope checked.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path

import numpy as np

from workstreams.prediction.spread_audit import (
    BASE, OWNED, PREFIXES, blob, digest, parse_export, output_directory,
    temporal_dispersion, write_json, compare_alerts,
)


def family_score(scores, indices, q, threshold):
    selected = scores[indices]
    valid = np.isfinite(selected)
    statistic = float(np.quantile(np.where(valid, selected, 0.), q))
    hits = valid & (selected > threshold)
    passed = valid.sum() >= math.ceil(.95 * len(indices)) and hits.sum() >= 3 and statistic > threshold
    return statistic, int(hits.sum()), bool(passed)


def oracle(scores, families, references, q=.95, margin=1.2, persistence=2):
    thresholds = {f: max(math.log(2), margin * max(
        float(np.quantile(scores[w, count][js], q))
        for w in references for count in PREFIXES)) for f, js in families.items()}
    scans, additions = [], {}
    for w in range(1, 26):
        streak = Counter()
        for count in PREFIXES:
            possible = []
            for f, js in families.items():
                value, hits, passed = family_score(scores[w, count], js, q, thresholds[f])
                streak[f] = streak[f] + 1 if passed else 0
                record = {'wafer': w, 'completed_devices': count, 'family': f,
                          'statistic': value, 'threshold': thresholds[f], 'normalized': value / thresholds[f],
                          'hits': hits, 'family_tests': len(js), 'passed': passed, 'streak': streak[f]}
                scans.append(record)
                if streak[f] >= persistence and w not in additions:
                    possible.append(record)
            if possible:
                additions[w] = max(possible, key=lambda r: r['normalized'])
    return thresholds, scans, additions


def run(output):
    output = output_directory(output)
    output.mkdir(parents=True, exist_ok=True)
    artifact_raw = blob('grp6_app/artifacts/runtime.json')
    artifact = json.loads(artifact_raw)
    references = artifact['detector_calibration']['normal_fit_wafers']
    inputs = {'grp6_app/artifacts/runtime.json': digest(artifact_raw)}
    datasets, pooled, meanlog, per_site = {}, {}, {}, {}
    names = None
    for w in range(1, 26):
        path = 'source_review/training/Data/A12345_W%02d_RawResult.csv' % w
        raw = blob(path); inputs[path] = digest(raw)
        current, meta, x, _ = parse_export(raw)
        if names is None:
            names = current
        if names != current or len(x) != 80:
            raise ValueError('Inconsistent supplied data')
        sites = np.array([m['Site'] for m in meta])
        datasets[w] = x, sites
        floor = np.array([max(artifact['baselines'].get(n, {}).get('sd', 1e-8) * .1, 1e-12) for n in names])
        for count in PREFIXES:
            temporal = temporal_dispersion(x, sites, count, floor)
            pooled[w, count] = -np.log(temporal['within'][2])
            per_site[w, count] = np.array([-np.log(temporal[s][2]) for s in ('1', '2', '3', '4')])
            meanlog[w, count] = np.mean(per_site[w, count], axis=0)
    families = {}
    for j, name in enumerate(names):
        if name in artifact['baselines']:
            families.setdefault(name.split('_', 1)[-1].rsplit('.', 1)[0], []).append(j)
    families = {f: js for f, js in families.items() if len(js) >= 20}
    thresholds, scans, additions = oracle(pooled, families, references)
    # Predeclared one-factor sensitivity checks; no parameter is selected here.
    variants = [('q80', pooled, .8, 1.2, 2), ('q90', pooled, .9, 1.2, 2),
                ('q95_proposed', pooled, .95, 1.2, 2), ('q975', pooled, .975, 1.2, 2),
                ('q99', pooled, .99, 1.2, 2), ('margin1', pooled, .95, 1., 2),
                ('margin1_5', pooled, .95, 1.5, 2), ('persistence1', pooled, .95, 1.2, 1),
                ('persistence3', pooled, .95, 1.2, 3), ('mean_site_log_q95', meanlog, .95, 1.2, 2)]
    sensitivity = []
    for name, scores, q, margin, persistence in variants:
        gates, _, found = oracle(scores, families, references, q, margin, persistence)
        sensitivity.append({'variant': name, 'q': q, 'normal_margin': margin, 'persistence': persistence,
                            'thresholds': gates, 'additions': list(found.values())})
    evidence = []
    for w, alert in additions.items():
        count, family = alert['completed_devices'], alert['family']
        js = families[family]
        x, sites = datasets[w]
        early_vars, late_vars = [], []
        for s in ('1', '2', '3', '4'):
            seq = x[:count][sites[:count] == s]
            half = len(seq) // 2
            early_vars.append(np.var(seq[:half], axis=0))
            late_vars.append(np.var(seq[-half:], axis=0))
        early_vars, late_vars = np.array(early_vars), np.array(late_vars)
        supporting = [j for j in js if pooled[w, count][j] > thresholds[family]]
        details = []
        for j in supporting:
            total = early_vars[:, j].sum()
            details.append({'test': names[j], 'pooled_log_drop': float(pooled[w, count][j]),
                            'site_log_drops': per_site[w, count][:, j].tolist(),
                            'early_site_variances': early_vars[:, j].tolist(),
                            'late_site_variances': late_vars[:, j].tolist(),
                            'dominant_early_variance_site': str(int(np.argmax(early_vars[:, j])) + 1),
                            'dominant_early_variance_fraction': float(max(early_vars[:, j]) / total) if total else None})
        evidence.append({**alert, 'supporting_test_details': details,
                         'dominant_site_counts': dict(Counter(d['dominant_early_variance_site'] for d in details)),
                         'mean_site_log_q95': float(np.quantile(meanlog[w, count][js], .95)),
                         'site_log_q95': {str(s+1): float(np.quantile(per_site[w, count][s, js], .95)) for s in range(4)}})
    # Explicitly mark these as oracle additions, not C implementation output.
    baseline_path = output / 'baseline.json'
    baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    candidate = json.loads(json.dumps(baseline))
    candidate['source'] = 'B independent arithmetic oracle; not C implementation'
    for record in candidate['wafers']:
        if record['wafer'] in additions:
            a = additions[record['wafer']]
            record['alerts'].append({'kind': 'spread_down', 'site': 'all', 'test': 'ORACLE:' + a['family'],
                                     'completed_devices': a['completed_devices']})
    write_json(output / 'pooled-oracle-summary.json', candidate)
    comparison = compare_alerts(baseline, candidate)
    write_json(output / 'pooled-oracle-acceptance.json', comparison)
    report = {
        'base': BASE, 'inputs_sha256': inputs, 'baseline_sha256': digest(baseline_path.read_bytes()),
        'oracle_sha256': digest(Path(__file__).read_bytes()),
        'shared_b_math_sha256': digest((OWNED / 'spread_audit.py').read_bytes()),
        'normal_fit_wafers': references, 'thresholds': thresholds,
        'formulation': '-log(max(RMS late within-site SD,0.1*baselineSD)/max(RMS early within-site SD,0.1*baselineSD)); family linear q95',
        'additions': list(additions.values()), 'all_scans': scans, 'supporting_evidence': evidence,
        'sensitivity': sensitivity, 'acceptance': comparison['checks'],
        'limits': ['Independent arithmetic implementation on reused data, not independent validation.',
                   '80-device data cannot exercise truncation beyond 20 samples/site; candidate controls must cover that.',
                   'Two adjacent scans reuse most samples and are not independent confirmation.',
                   'Parameter/method exploration has inspected W25; normal-only thresholds do not remove selection bias.',
                   'Added categories on abnormal wafers are not confirmed ground truth.',
                   'Oracle does not import or certify C streaming/reset/missing-data implementation.']
    }
    write_json(output / 'pooled-challenge.json', report)
    print(json.dumps({'thresholds': thresholds, 'additions': list(additions.values()),
                      'acceptance': comparison['checks']}, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(OWNED / 'round3'))
    args = parser.parse_args()
    run(args.output)


if __name__ == '__main__':
    main()
