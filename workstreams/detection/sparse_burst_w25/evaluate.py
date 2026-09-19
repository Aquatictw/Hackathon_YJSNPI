"""All-25 offline evaluation of the sparse-burst spread-down supplement.

The rule and every threshold are frozen in grp6_app/artifacts/sparse_burst.json
(built by grp6_app.calibrate_burst from normal-fit wafers) before this script
reads any label. Labels only score results. All wafers were inspected during
development; nothing here is an independent holdout.

Sections: stdlib runtime replay (core-only, core+supplement), independent NumPy
oracle, core-miss diagnosis, sensitivity (parameters, start position, leave-one-
out calibrations), multiple-testing accounting and timing.
"""
import argparse
import csv
import hashlib
import json
import math
import platform
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

from grp6_app.build_models import load_matrix
from grp6_app.rehearse import EXPECTED
from grp6_app.runtime import RuntimeModels, WaferDetector
from grp6_app.sparse_burst import DETECTOR_ID, family_of, fisher_early_greater

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
NORMAL_LABELED = [w for w in range(1, 26) if w not in EXPECTED]
NORMAL_FIT = [2, 4, 5, 7, 8, 10, 11, 13, 16, 17, 19, 20, 22]
NORMAL_CHECK = [w for w in NORMAL_LABELED if w not in NORMAL_FIT]
MAD_K, MEAN_AD_K, FLOOR_REL = 1.4826, 1.2533141373155003, 1e-9


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(alert):
    return json.dumps(alert, sort_keys=True, allow_nan=False)


def label(wafer):
    group = 'normal_fit' if wafer in NORMAL_FIT else 'normal_check' if wafer in NORMAL_CHECK else 'anomaly'
    return EXPECTED.get(wafer, 'normal'), group


def read_wafer(path):
    with path.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.reader(handle)
        header = next(reader)
        for _ in range(4):
            next(reader)
        for row in reader:
            if not row or not row[0].isdigit():
                continue
            meta = dict(zip(header[:10], row[:10]))
            values = {k: float(v) for k, v in zip(header[10:], row[10:]) if v.strip()}
            yield meta, values


# --------------------------------------------------------------------------
# Core family-gate replica, used only to explain the core miss. Its spread
# scores are validated against the core detector's own persistence counters.
# --------------------------------------------------------------------------
def core_family_scores(detector):
    metrics = defaultdict(list)
    for name, series in detector.values.items():
        if len(series) < 24:
            continue
        sd = max(detector.baselines[name]['sd'], 1e-9)
        groups = {s: v for s, v in detector.site_values[name].items() if len(v) >= 4}
        imbalance, changes, log_ratios = 0., [], []
        if len(groups) >= 2:
            means = {s: sum(v) / len(v) for s, v in groups.items()}
            imbalance = (max(means.values()) - min(means.values())) / sd
        for seq in groups.values():
            if len(seq) < 6:
                continue
            half = len(seq) // 2
            first, last = seq[:half], seq[-half:]
            fm, lm = sum(first) / len(first), sum(last) / len(last)
            changes.append(abs((lm - fm) / sd))
            fsd = math.sqrt(sum((v - fm) ** 2 for v in first) / len(first))
            lsd = math.sqrt(sum((v - lm) ** 2 for v in last) / len(last))
            log_ratios.append(math.log(max(lsd, sd * .1) / max(fsd, sd * .1)))
        if changes and log_ratios:
            avg = sum(log_ratios) / len(log_ratios)
            metrics[name.split('_', 1)[1].rsplit('.', 1)[0]].append([imbalance, max(changes), avg, -avg])

    def q80(values):
        ordered = sorted(values)
        pos = .8 * (len(ordered) - 1)
        i = int(pos)
        return ordered[i] + (ordered[min(i + 1, len(ordered) - 1)] - ordered[i]) * (pos - i)
    out = {}
    for family, rows in metrics.items():
        thresholds = detector.family_thresholds.get(family)
        if not thresholds:
            continue
        raw = [q80([r[k] for r in rows]) for k in range(4)]
        out[family] = {'q80': raw, 'thresholds': list(thresholds),
                       'ratio': [raw[k] / max(t, .1) for k, t in enumerate(thresholds)],
                       'tests': len(rows)}
    return out


# --------------------------------------------------------------------------
# Stage 1: stdlib runtime replay of all 25 wafers.
# --------------------------------------------------------------------------
def replay(data_dir, artifacts, accepted):
    models = RuntimeModels(Path(artifacts) / 'runtime.json')
    if models.sparse_burst is None:
        raise SystemExit('sparse-burst artifact unavailable: ' + models.sparse_burst_status)
    base, thresholds = models.artifact['baselines'], models.artifact.get('family_thresholds')
    accepted_alerts = {w['wafer']: [canonical(a) for a in w['alerts']] for w in accepted['wafers']}
    timings = defaultdict(list)
    wafers, detectors, replica_checks = {}, {}, {'scans': 0, 'mismatches': []}
    diagnosis = {}
    for path in sorted(Path(data_dir).glob('*_RawResult.csv')):
        core_only = WaferDetector(base, thresholds)
        full = models.detector()
        core_alerts, supplement_alerts, core_only_alerts = [], [], []
        wafer, good, pids = None, 0, []
        streaks = {}
        for meta, values in read_wafer(path):
            wafer = int(meta['Wafer'])
            passed = meta['SBin'] == '1'
            good += passed
            pids.append(meta['PID'])
            core_only.add(meta['Site'], values, passed)
            core_only_alerts.extend(core_only.analyze())
            started = time.perf_counter_ns()
            full.add(meta['Site'], values, passed, meta['PID'])
            timings['full_add_ms'].append((time.perf_counter_ns() - started) / 1e6)
            started = time.perf_counter_ns()
            new_core = full._analyze_core()
            core_ns = time.perf_counter_ns() - started
            started = time.perf_counter_ns()
            new_supplement = full.sparse_burst.analyze()
            supplement_ns = time.perf_counter_ns() - started
            completed = full.completed
            if completed % 8 == 0:
                timings['core_scan_ms'].append(core_ns / 1e6)
                if completed >= full.sparse_burst.calibration.first_scan:
                    timings['supplement_scan_ms'].append(supplement_ns / 1e6)
                    timings['combined_scan_ms'].append((core_ns + supplement_ns) / 1e6)
            core_alerts.extend(new_core)
            supplement_alerts.extend(new_supplement)
            if completed % 8 == 0 and completed >= 32:
                scores = core_family_scores(full)
                for family, score in scores.items():
                    for k, ratio in enumerate(score['ratio']):
                        key = (family, k)
                        streaks[key] = streaks.get(key, 0) + 1 if ratio > 1 else 0
                        replica_checks['scans'] += 1
                        if streaks[key] != full.family_streak.get(key, 0):
                            replica_checks['mismatches'].append([wafer, completed, family, k])
                sub1 = scores.get('Main.subflow1')
                if sub1:
                    diagnosis.setdefault(wafer, []).append(
                        {'completed_devices': completed, 'spread_down_q80_neg_avg_log': sub1['q80'][3],
                         'spread_down_family_threshold': sub1['thresholds'][3],
                         'spread_down_ratio': sub1['ratio'][3], 'spread_up_ratio': sub1['ratio'][2],
                         'tests': sub1['tests']})
        core_only_alerts.extend(core_only.analyze(True))
        started = time.perf_counter_ns()
        core_alerts.extend(full._analyze_core(True))
        supplement_alerts.extend(full.sparse_burst.analyze(True))
        timings['final_scan_ms'].append((time.perf_counter_ns() - started) / 1e6)
        detectors[wafer] = full
        wafers[wafer] = {
            'devices': full.completed, 'yield': good / max(full.completed, 1), 'pids': pids,
            'core_alerts': core_alerts, 'supplement_alerts': supplement_alerts,
            'core_identical_to_core_only': [canonical(a) for a in core_alerts] == [canonical(a) for a in core_only_alerts],
            'core_identical_to_accepted_replay': [canonical(a) for a in core_alerts] == accepted_alerts.get(wafer),
            'supplement_status': full.sparse_burst.status}
        print('W{:02d}: core {} | supplement {}'.format(
            wafer, ', '.join('{}@{}'.format(a['kind'], a['completed_devices']) for a in core_alerts) or '-',
            ', '.join('{}@{}'.format(a['kind'], a['completed_devices']) for a in supplement_alerts) or '-'), flush=True)
    return models, wafers, detectors, timings, replica_checks, diagnosis


def diagnostic_floors(detectors, calibration, positions):
    """Normal-fit maxima at every position, including unscanned ones (offline only)."""
    return {family: {pos: max(detectors[w].sparse_burst.window(family, pos)['early_burst_count'] for w in NORMAL_FIT)
                     for pos in positions} for family in calibration.families}


def burst_devices(detector, pids):
    calibration = detector.sparse_burst.calibration
    out = []
    for index, (site, device, extreme, present) in enumerate(detector.sparse_burst.devices):
        for family, items in sorted(extreme.items()):
            if len(items) >= calibration.min_extreme_tests:
                out.append({'device_index': index + 1, 'pid': pids[index], 'site': site, 'family': family,
                            'extreme_test_count': len(items),
                            'tests': [{'test': t, 'value': v, 'baseline_median': m, 'baseline_scale': s,
                                       'robust_z': z if math.isfinite(z) else 1e300}
                                      for t, v, m, s, z in sorted(items, key=lambda i: (-i[4], i[0]))]})
    return out


def summarize_alert(alert, source):
    out = {'kind': alert['kind'], 'source': source, 'detector': alert.get('detector', 'core_wafer_detector'),
           'family': alert.get('family', family_of(alert['test'])), 'completed_devices': alert['completed_devices'],
           'test': alert['test'], 'site': alert['site'], 'score': alert['score'], 'message': alert['message']}
    if source == 'supplementary':
        e = alert['burst_evidence']
        out.update({k: e[k] for k in ('early_burst_count', 'recent_burst_count', 'early_devices', 'recent_devices',
                                     'early_burst_rate', 'recent_burst_rate', 'rate_difference', 'rate_ratio',
                                     'rate_ratio_haldane', 'fisher_p', 'normal_max_early_bursts',
                                     'early_burst_sites')})
        out['burst_tests_and_sites'] = [{'device_index': b['device_index'], 'window': b['window'], 'site': b['site'],
                                         'pid': b['device_id'], 'extreme_test_count': b['extreme_test_count'],
                                         'tests': [t['test'] for t in b['tests']]} for b in e['burst_devices']]
    return out


# --------------------------------------------------------------------------
# Stage 2: independent NumPy oracle (separate parser and array arithmetic).
# --------------------------------------------------------------------------
class Oracle:
    def __init__(self, data_dir, families):
        names, rows, x = load_matrix(data_dir)
        self.names = names
        self.wafer = np.array([int(r['Wafer']) for r in rows])
        self.site = np.array([r['Site'] for r in rows])
        self.sites = sorted(set(self.site.tolist()), key=lambda s: (len(s), s))
        self.index = {n: j for j, n in enumerate(names)}
        self.families = {f: [self.index[t] for t in tests] for f, tests in families.items()}
        self.cols = [j for f in sorted(self.families) for j in self.families[f]]
        self.x = x[:, self.cols]
        offset, self.slices = 0, {}
        for f in sorted(self.families):
            self.slices[f] = slice(offset, offset + len(self.families[f]))
            offset += len(self.families[f])
        self.rows = {w: np.where(self.wafer == w)[0] for w in sorted(set(self.wafer.tolist()))}

    def baselines(self, fit):
        med, scale = {}, {}
        mask = np.isin(self.wafer, fit)
        for s in self.sites:
            a = self.x[mask & (self.site == s)]
            m = np.nanmedian(a, 0)
            dev = np.abs(a - m)
            floor = FLOOR_REL * np.maximum(1., np.abs(m))
            mad = np.nanmedian(dev, 0) * MAD_K
            mean_ad = np.nanmean(dev, 0) * MEAN_AD_K
            med[s] = m
            scale[s] = np.where(mad > floor, mad, np.where(mean_ad > floor, mean_ad, np.nan))
        return med, scale

    def counts(self, med, scale, z_limit):
        z = np.full(self.x.shape, np.nan)
        for s in self.sites:
            m = self.site == s
            with np.errstate(invalid='ignore'):
                z[m] = np.abs(self.x[m] - med[s]) / scale[s]
        with np.errstate(invalid='ignore'):
            extreme = z > z_limit
        return {f: extreme[:, sl].sum(1) for f, sl in self.slices.items()}

    def flags(self, counts, k):
        return {f: {w: (c[idx] >= k) for w, idx in self.rows.items()} for f, c in counts.items()}


def fisher_lgamma(early, early_n, recent, recent_n):
    """Independent hypergeometric tail via log-gamma (cross-checks the runtime)."""
    total, k = early_n + recent_n, early + recent
    if k == 0:
        return 1.
    def lc(n, r):
        return math.lgamma(n + 1) - math.lgamma(r + 1) - math.lgamma(n - r + 1)
    denom = lc(total, k)
    return min(1., sum(math.exp(lc(early_n, i) + lc(recent_n, k - i) - denom)
                       for i in range(early, min(k, early_n) + 1)))


def gate(flags, position, floor, alpha):
    half = position // 2
    e, r = int(flags[:half].sum()), int(flags[half:position].sum())
    p = fisher_early_greater(e, half, r, position - half)
    return e, r, p, (floor is not None and e > floor and e > r and p <= alpha)


def evaluate_rule(flags, fit, first, alpha, interval=8, last=80, wafers=range(1, 26)):
    positions = list(range(first, last + 1, interval))
    floors = {f: {pos: max(int(flags[f][w][:pos // 2].sum()) for w in fit) for pos in positions} for f in flags}
    alerts = {}
    for w in wafers:
        for pos in positions:
            hits = [f for f in sorted(flags) if gate(flags[f][w], pos, floors[f][pos], alpha)[3]]
            if hits:
                alerts[w] = [pos, hits]
                break
    return floors, alerts


def sensitivity(oracle, fit_med, fit_scale, config):
    grid = []
    for z_limit in (10., 15., 20., 25., 30., 40.):
        counts = oracle.counts(fit_med, fit_scale, z_limit)
        for k in (2, 3, 4, 5, 6):
            flags = oracle.flags(counts, k)
            for first in (32, 48, 56, 64, 72, 80):
                for alpha in (.05, .10, .20):
                    _, alerts = evaluate_rule(flags, NORMAL_FIT, first, alpha)
                    grid.append({'z_threshold': z_limit, 'min_extreme_tests': k, 'first_scan_devices': first,
                                 'fisher_alpha': alpha, 'alerts': {str(w): a for w, a in sorted(alerts.items())},
                                 'w25_detected': 25 in alerts, 'w15_alerted': 15 in alerts,
                                 'normal_labeled_alerted': sorted(w for w in alerts if w in NORMAL_LABELED),
                                 'anomaly_labeled_alerted': sorted(w for w in alerts if w not in NORMAL_LABELED)})
    chosen = [g for g in grid if g['z_threshold'] == config['z_threshold']
              and g['min_extreme_tests'] == config['min_extreme_tests']
              and g['first_scan_devices'] == config['first_scan_devices'] and g['fisher_alpha'] == config['fisher_alpha']]
    clean = [g for g in grid if g['w25_detected'] and not g['normal_labeled_alerted']]
    return {'grid_size': len(grid), 'chosen': chosen,
            'configs_detecting_w25': sum(g['w25_detected'] for g in grid),
            'configs_detecting_w25_without_normal_label_alert': len(clean),
            'configs_detecting_w25_without_any_other_alert': sum(
                g['w25_detected'] and g['anomaly_labeled_alerted'] == [25] and not g['normal_labeled_alerted'] for g in grid),
            'clean_configs': [{k: g[k] for k in ('z_threshold', 'min_extreme_tests', 'first_scan_devices', 'fisher_alpha',
                                                 'anomaly_labeled_alerted')} for g in clean],
            'grid': grid}


def start_position_table(flags, alpha):
    rows = []
    for first in range(8, 81, 8):
        floors, alerts = evaluate_rule(flags, NORMAL_FIT, first, alpha, last=first)
        rows.append({'scan_position': first, 'subflow1_floor': floors['Main.subflow1'][first],
                     'alerting_wafers': {str(w): a for w, a in sorted(alerts.items())}})
    return rows


def loo(oracle, config, pool, label_text):
    """Leave one wafer of `pool` out of both baselines and floors, then score it."""
    out = []
    for held in pool:
        fit = [w for w in pool if w != held]
        med, scale = oracle.baselines(fit)
        flags = oracle.flags(oracle.counts(med, scale, config['z_threshold']), config['min_extreme_tests'])
        floors, alerts = evaluate_rule(flags, fit, config['first_scan_devices'], config['fisher_alpha'])
        out.append({'held_out': held, 'calibration': label_text,
                    'floors_subflow1': {str(k): v for k, v in floors['Main.subflow1'].items()},
                    'held_out_alerted': alerts.get(held), 'w25': alerts.get(25), 'w15': alerts.get(15),
                    'other_alerts': {str(w): a for w, a in sorted(alerts.items()) if w not in (held, 25, 15)}})
    return out


def multiple_testing(oracle_flags, alpha, floors_diag):
    """Scans with early>recent and p<=alpha, with and without the normal floor."""
    out = {}
    for group, wafers in (('normal_fit', NORMAL_FIT), ('normal_check', NORMAL_CHECK),
                          ('anomaly', [w for w in range(1, 26) if w in EXPECTED])):
        rows = []
        for w in wafers:
            for f in sorted(oracle_flags):
                for pos in range(8, 81, 8):
                    e, r, p, _ = gate(oracle_flags[f][w], pos, None, alpha)
                    if e > r and p <= alpha:
                        rows.append({'wafer': w, 'family': f, 'position': pos, 'early': e, 'recent': r,
                                     'fisher_p': p, 'normal_fit_floor': floors_diag[f][pos],
                                     'above_floor': e > floors_diag[f][pos],
                                     'in_runtime_scan_range': pos >= 72})
        out[group] = {'scans_tested': len(wafers) * len(oracle_flags) * 10,
                      'p_le_alpha_and_early_gt_recent': len(rows),
                      'also_above_floor_any_position': sum(r['above_floor'] for r in rows),
                      'also_above_floor_in_runtime_range': sum(r['above_floor'] and r['in_runtime_scan_range'] for r in rows),
                      'rows': rows}
    return out


def percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))] if ordered else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--data', default=str(ROOT / 'source_review/training/Data'))
    parser.add_argument('--artifacts', default=str(ROOT / 'grp6_app/artifacts'))
    parser.add_argument('--accepted-replay', default=str(ROOT / 'results/replay/summary.json'))
    parser.add_argument('--output', default=str(HERE / 'results.json'))
    args = parser.parse_args(argv)
    output = Path(args.output).resolve()
    if HERE not in output.parents:
        raise SystemExit('output must stay inside ' + str(HERE))
    started_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    inputs = {p.name: sha(p) for p in sorted(Path(args.data).glob('*_RawResult.csv'))}
    code = {str(p.relative_to(ROOT)).replace('\\', '/'): sha(p) for p in
            [ROOT / 'grp6_app/sparse_burst.py', ROOT / 'grp6_app/calibrate_burst.py', ROOT / 'grp6_app/runtime.py',
             ROOT / 'grp6_app/monitor.py', ROOT / 'grp6_app/rehearse.py', Path(__file__)]}
    accepted = json.loads(Path(args.accepted_replay).read_text(encoding='utf-8'))

    models, wafers, detectors, timings, replica, diagnosis = replay(args.data, args.artifacts, accepted)
    calibration = models.sparse_burst
    artifact = json.loads((Path(args.artifacts) / 'sparse_burst.json').read_text(encoding='utf-8'))
    config = {k: artifact['config'][k] for k in ('z_threshold', 'min_extreme_tests', 'first_scan_devices',
                                                'scan_interval_devices', 'fisher_alpha', 'min_family_coverage')}
    positions = list(range(8, 81, 8))
    floors_diag = diagnostic_floors(detectors, calibration, positions)

    # Stage 2: oracle cross-check of baselines, burst flags, floors and p-values.
    oracle = Oracle(args.data, artifact['families'])
    med, scale = oracle.baselines(NORMAL_FIT)
    max_rel = 0.
    for s in oracle.sites:
        for f, sl in oracle.slices.items():
            for j, test in enumerate(artifact['families'][f]):
                m, sc = artifact['baselines'][s][test]
                om, osc = med[s][sl][j], scale[s][sl][j]
                max_rel = max(max_rel, abs(m - om) / max(abs(m), 1e-300), abs(sc - osc) / sc)
    flags = oracle.flags(oracle.counts(med, scale, config['z_threshold']), config['min_extreme_tests'])
    flag_mismatch = [[w, f] for w in range(1, 26) for f in sorted(flags)
                     if list(map(bool, flags[f][w])) != detectors[w].sparse_burst.burst_flags(f)]
    oracle_floors, oracle_alerts = evaluate_rule(flags, NORMAL_FIT, config['first_scan_devices'], config['fisher_alpha'])
    floor_mismatch = [[f, pos] for f in oracle_floors for pos in oracle_floors[f]
                      if oracle_floors[f][pos] != calibration.floor(f, pos)]
    p_diffs = []
    for w in range(1, 26):
        for scan in detectors[w].sparse_burst.scans:
            for s in scan['families']:
                p_diffs.append(abs(s['fisher_p'] - fisher_lgamma(s['early_burst_count'], s['early_devices'],
                                                                 s['recent_burst_count'], s['recent_devices'])))
    runtime_alerts = {w: [wafers[w]['supplement_alerts'][0]['completed_devices'],
                          [wafers[w]['supplement_alerts'][0]['family']]]
                      for w in wafers if wafers[w]['supplement_alerts']}
    oracle_check = {'baseline_max_relative_difference': max_rel, 'burst_flag_mismatches': flag_mismatch,
                    'floor_mismatches': floor_mismatch, 'max_fisher_abs_difference_vs_lgamma': max(p_diffs),
                    'oracle_alerts': {str(w): a for w, a in sorted(oracle_alerts.items())},
                    'runtime_alerts': {str(w): a for w, a in sorted(runtime_alerts.items())},
                    'alerts_agree': {str(w): a for w, a in oracle_alerts.items()} ==
                                    {str(w): a for w, a in runtime_alerts.items()}}

    # Per-wafer report.
    wafer_rows = []
    for w in range(1, 26):
        record, det = wafers[w], detectors[w]
        expected, group = label(w)
        alerts = ([summarize_alert(a, 'core') for a in record['core_alerts']] +
                  [summarize_alert(a, 'supplementary') for a in record['supplement_alerts']])
        first = {}
        for a in alerts:
            first.setdefault(a['kind'], a['completed_devices'])
        scans = [{**{k: s[k] for k in ('family', 'completed_devices', 'early_burst_count', 'recent_burst_count',
                                       'early_burst_rate', 'recent_burst_rate', 'rate_difference', 'rate_ratio',
                                       'rate_ratio_haldane', 'fisher_p', 'normal_max_early_bursts',
                                       'low_coverage_devices', 'passed', 'reason')}}
                 for scan in det.sparse_burst.scans for s in scan['families']]
        diagnostic = []
        for f in calibration.families:
            if not any(det.sparse_burst.burst_flags(f)):
                continue
            for pos in positions:
                win = det.sparse_burst.window(f, pos)
                floor = floors_diag[f][pos]
                diagnostic.append({'family': f, 'position': pos, 'early': win['early_burst_count'],
                                   'recent': win['recent_burst_count'], 'fisher_p': win['fisher_p'],
                                   'normal_fit_floor': floor, 'rate_difference': win['rate_difference'],
                                   'would_pass_if_scanned': win['early_burst_count'] > floor and
                                   win['early_burst_count'] > win['recent_burst_count'] and
                                   win['fisher_p'] <= config['fisher_alpha'],
                                   'runtime_scans_here': pos >= config['first_scan_devices']})
        wafer_rows.append({
            'wafer': w, 'label': expected, 'label_group': group,
            'development_note': ('inspected during development; not an independent holdout'
                                 if w in NORMAL_CHECK else 'normal-fit calibration wafer (in-sample)'
                                 if w in NORMAL_FIT else 'labeled anomaly example inspected during development'),
            'devices': record['devices'], 'yield': record['yield'],
            'alert_categories': sorted({a['kind'] for a in alerts}), 'alerts': alerts,
            'first_alert_by_category': first,
            'expected_category_first_device': first.get(expected) if expected != 'normal' else None,
            'new_supplementary_alerts': [a for a in alerts if a['source'] == 'supplementary'],
            'core_alerts_identical_to_core_only_detector': record['core_identical_to_core_only'],
            'core_alerts_identical_to_accepted_replay': record['core_identical_to_accepted_replay'],
            'supplement_status': record['supplement_status'],
            'runtime_scans': scans, 'diagnostic_windows_all_positions': diagnostic,
            'burst_devices': burst_devices(det, record['pids']),
            'core_subflow1_family_gate': diagnosis.get(w, [])})

    by_wafer = {r['wafer']: r for r in wafer_rows}
    normal_new = {str(w): by_wafer[w]['new_supplementary_alerts'] for w in NORMAL_LABELED
                  if by_wafer[w]['new_supplementary_alerts']}
    retained = {str(w): {'expected': EXPECTED[w], 'first_device': by_wafer[w]['first_alert_by_category'].get(EXPECTED[w]),
                         'retained': EXPECTED[w] in by_wafer[w]['alert_categories']}
                for w in (1, 3, 9, 14, 18, 23)}
    timing = {k: {'n': len(v), 'p50': percentile(v, .5), 'p95': percentile(v, .95), 'max': max(v)}
              for k, v in sorted(timings.items())}
    w25 = by_wafer[25]['new_supplementary_alerts']
    answers = {
        '1_w25_spread_down_at_or_before_72': {
            'answer': bool(w25) and w25[0]['completed_devices'] <= 72,
            'first_completed_device': w25[0]['completed_devices'] if w25 else None,
            'family': w25[0]['family'] if w25 else None},
        '2_w15_no_alert': {'answer': not by_wafer[15]['alerts'], 'alerts': by_wafer[15]['alerts']},
        '3_new_false_positives_on_normal_labeled_wafers': {
            'count': sum(len(v) for v in normal_new.values()), 'wafers': normal_new,
            'normal_labeled_wafers': NORMAL_LABELED,
            'existing_core_alert_on_normal_label': {str(w): by_wafer[w]['alert_categories'] for w in NORMAL_LABELED
                                                    if by_wafer[w]['alerts']}},
        '4_w23_spread_up_retained': retained['23'],
        '5_original_categories_retained': {k: v for k, v in retained.items() if k != '23'},
        '6_worst_scan_ms': {'supplement_scan_max': timing['supplement_scan_ms']['max'],
                            'core_scan_max': timing['core_scan_ms']['max'],
                            'combined_scan_max': timing['combined_scan_ms']['max'],
                            'full_add_max': timing['full_add_ms']['max'],
                            'note': 'single local Windows/Python run; wall-clock, not an Edge deadline'}}
    supplementary_all = {str(w): by_wafer[w]['new_supplementary_alerts'] for w in range(1, 26)
                         if by_wafer[w]['new_supplementary_alerts']}

    print('sensitivity / leave-one-out ...', flush=True)
    sens = sensitivity(oracle, med, scale, config)
    start_table = start_position_table(flags, config['fisher_alpha'])
    loo_fit = loo(oracle, config, NORMAL_FIT, 'normal_fit minus held-out wafer')
    loo_normal = loo(oracle, config, NORMAL_LABELED, 'all 18 normal-labeled minus held-out wafer (diagnostic only)')
    med18, scale18 = oracle.baselines(NORMAL_LABELED)
    flags18 = oracle.flags(oracle.counts(med18, scale18, config['z_threshold']), config['min_extreme_tests'])
    floors18, alerts18 = evaluate_rule(flags18, NORMAL_LABELED, config['first_scan_devices'], config['fisher_alpha'])
    floors_fit_baseline_18 = evaluate_rule(flags, NORMAL_LABELED, config['first_scan_devices'], config['fisher_alpha'])
    mt = multiple_testing(flags, config['fisher_alpha'], floors_diag)

    result = {
        'title': 'Sparse extreme-burst spread-down supplement: all-25 development evaluation',
        'status': 'DEVELOPMENT CANDIDATE - not independent validation',
        'disclosure': artifact['provenance']['warning'],
        'started_at_utc': started_at, 'python': sys.version.split()[0], 'platform': platform.platform(),
        'inputs_sha256': inputs, 'code_sha256': code,
        'artifacts_sha256': {'runtime.json': sha(Path(args.artifacts) / 'runtime.json'),
                             'sparse_burst.json': sha(Path(args.artifacts) / 'sparse_burst.json')},
        'accepted_replay_sha256': sha(args.accepted_replay),
        'frozen_rule': {'config': config, 'families': calibration.families,
                        'normal_max_early_bursts': calibration.summary()['normal_max_early_bursts'],
                        'normal_fit_wafers': NORMAL_FIT, 'normal_fit_scans': artifact['normal_fit_scans'],
                        'gate': 'completed>=first_scan and (completed-first_scan)%interval==0 and every prefix device has '
                                '>=min_family_coverage of calibrated family tests and early>normal_max_early_bursts and '
                                'early>recent and one-sided Fisher p<=alpha; one supplementary emission per wafer'},
        'answers': answers, 'supplementary_alerts_all_wafers': supplementary_all, 'wafers': wafer_rows,
        'core_regression': {
            'all_core_alerts_identical_to_core_only': all(r['core_alerts_identical_to_core_only_detector'] for r in wafer_rows),
            'all_core_alerts_identical_to_accepted_replay': all(r['core_alerts_identical_to_accepted_replay'] for r in wafer_rows),
            'core_alert_count': sum(len(wafers[w]['core_alerts']) for w in wafers)},
        'core_replica_validation': {'scan_family_index_checks': replica['scans'], 'mismatches': replica['mismatches']},
        'oracle_check': oracle_check,
        'diagnostic_normal_fit_floors_all_positions': {f: {str(p): v for p, v in fl.items()} for f, fl in floors_diag.items()},
        'start_position_sensitivity': start_table,
        'sensitivity': sens,
        'leave_one_out_normal_fit': loo_fit,
        'leave_one_out_all_normal_labeled': loo_normal,
        'calibrated_on_all_18_normal_labeled': {
            'floors_subflow1': {str(k): v for k, v in floors18['Main.subflow1'].items()},
            'alerts': {str(w): a for w, a in sorted(alerts18.items())},
            'fit_baselines_18_wafer_floors_alerts': {str(w): a for w, a in sorted(floors_fit_baseline_18[1].items())}},
        'multiple_testing': mt,
        'timing_ms': timing,
    }
    output.write_text(json.dumps(result, indent=1, allow_nan=False), encoding='utf-8')
    print(json.dumps({'answers': answers, 'core_regression': result['core_regression'],
                      'oracle': {k: v for k, v in oracle_check.items() if k not in ('oracle_alerts', 'runtime_alerts')},
                      'replica_mismatches': len(replica['mismatches']),
                      'sensitivity': {k: v for k, v in sens.items() if k not in ('grid', 'clean_configs', 'chosen')}},
                     indent=1, default=str))
    return result


if __name__ == '__main__':
    main()
