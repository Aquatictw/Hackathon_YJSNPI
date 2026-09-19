"""A's read-only cross-review of R3 research. Run from repository root.

Writes only results/r3_research_review.json. Passing this audit confirms a
reproducible rejection, never detector acceptance or an independent holdout.
"""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workstreams.detection.synthetic_round3 import run_stream, stream
from workstreams.detection.pooled_candidate import PooledSpreadDecrease


def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def run():
    b = read('workstreams/prediction/round3/pooled-challenge.json')
    c = read('workstreams/detection/round3/evaluation.json')
    snapshot = read('workstreams/prediction/round3/c-snapshot-controls.json')
    baseline = read('results/replay/summary.json')
    checks = {}
    for path, expected in b['inputs_sha256'].items():
        raw = subprocess.check_output(['git', 'show', b['base'] + ':' + path], cwd=ROOT)
        assert digest(raw) == expected, path
        # Record Git bytes and checkout bytes separately; only CRLF differs.
        assert raw.replace(b'\r\n', b'\n') == (ROOT / path).read_bytes().replace(b'\r\n', b'\n'), path
    checks['b_immutable_inputs_and_checkout_equivalence'] = True
    for path, expected in c['source_and_input_sha256'].items():
        assert digest((ROOT / path).read_bytes()) == expected, path
    checks['c_exact_recorded_inputs_and_sources'] = True
    assert digest((ROOT / 'workstreams/detection/pooled_candidate.py').read_bytes()) == snapshot['source_sha256']
    assert digest((ROOT / snapshot['preserved_source_snapshot']).read_bytes()) == snapshot['source_sha256']
    checks['independent_controls_bind_same_candidate'] = True
    saved = {w['wafer']: w for w in baseline['wafers']}
    assert len(c['wafers']) == 25 and sum(w['devices'] for w in c['wafers']) == 2000
    for w in c['wafers']:
        assert w['baseline_alerts'] == saved[w['wafer']]['alerts'], w['wafer']
        assert w['removed_alerts'] == []
        assert len(w['combined_alerts']) == len(w['baseline_alerts']) + len(w['added_alerts'])
    checks['all_14_baseline_alerts_preserved_exactly'] = sum(len(w['baseline_alerts']) for w in c['wafers']) == 14
    ca = [(w['wafer'], a['completed_devices'], a['family']) for w in c['wafers'] for a in w['added_alerts']]
    ba = [(a['wafer'], a['completed_devices'], a['family']) for a in b['additions']]
    assert ca == ba and [(w, n) for w, n, _ in ca] == [(1, 56), (3, 40), (14, 64), (18, 64), (23, 64), (25, 80)]
    checks['independent_arithmetic_reproduces_six_additions'] = True
    bs = {(s['wafer'], s['completed_devices'], s['family']): s for s in b['all_scans']}
    scan_count = 0
    for w in c['wafers']:
        for s in w['candidate_scans']:
            other = bs[w['wafer'], s['completed_devices'], s['family']]
            for key in ('statistic', 'threshold'):
                assert math.isclose(s[key], other[key], abs_tol=1e-9, rel_tol=1e-9), (w['wafer'], key)
            assert s['passed'] == other['passed']
            scan_count += 1
    checks['all_scan_scores_match_independent_oracle'] = scan_count == len(bs)
    normal = [w for w in c['wafers'] if w['expected'] == 'normal']
    checks['all_18_normal_labels_no_added_alerts'] = len(normal) == 18 and not any(w['added_alerts'] for w in normal)
    failed_modes = c['synthetic']['by_mode']['location_step']
    assert failed_modes == {'runs': 20, 'alerts': 20, 'expectation_failures': 20}
    assert c['synthetic']['expectation_failures'] == 20
    reproduced_mean_failures = sum(bool(run_stream(stream('location_step', seed))[1]) for seed in range(20))
    checks['a_reproduces_20_mean_shift_false_alerts'] = reproduced_mean_failures == 20
    failures = [k for k, passed in snapshot['checks'].items() if not passed]
    assert sorted(failures) == ['mean_step_no_spread_alert', 'single_impulse_no_persistent_spread_alert']
    reproduced = {}
    for mode in ('mean_step', 'single_impulse'):
        detector = PooledSpreadDecrease(snapshot['calibration'])
        alerts = []
        for n in range(160):
            sample = n // 4
            value = (-1. if sample % 2 == 0 else 1.) * 2.
            if mode == 'mean_step' and sample >= 10:
                value += 100.
            if mode == 'single_impulse' and n == 0:
                value = 100.
            detector.add(str(n % 4 + 1), dict.fromkeys(detector.baseline_sd, value))
            alerts.extend(detector.analyze())
        reproduced[mode] = [a['completed_devices'] for a in alerts]
        assert alerts == snapshot['records'][mode]['alerts']
    checks['a_reproduces_b_step_and_impulse_failures'] = reproduced == {'mean_step': [96], 'single_impulse': [40]}
    assert all(checks.values()), checks
    report = {
        'round': 'R3-20260919', 'decision': 'REJECT_RUNTIME_AND_REPLAY_PROMOTION',
        'scope': 'A review of B/C negative research; R3 D/E delivery and combined acceptance remain pending',
        'checks': checks, 'compared_scans': scan_count,
        'diagnostic_only_additions': ca, 'reproduced_false_alerts': reproduced,
        'c_mean_step_false_alerts': reproduced_mean_failures,
        'accepted_detector_coverage': '6/7; W25 missed; existing runtime/artifact/replay unchanged',
        'candidate_source_sha256': snapshot['source_sha256'],
        'evidence_sha256': {p: digest((ROOT / p).read_bytes()) for p in (
            'workstreams/prediction/round3/pooled-challenge.json',
            'workstreams/prediction/round3/c-snapshot-controls.json',
            'workstreams/detection/round3/evaluation.json')},
        'limits': ['All 25 wafers are reused development data, not holdout.',
                   'Adjacent scans reuse observations; 7/7 category matching is not accepted detection.',
                   'W25 is sensitive to quantile/persistence choices; device80 is final boundary.',
                   'No new Edge deployment, tester receipt, unit or deadline acceptance.'],
    }
    (ROOT / 'results/r3_research_review.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    run()
