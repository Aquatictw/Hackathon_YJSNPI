"""Read-only A review of independent sparse-burst follow-up evidence."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
B = ROOT / 'workstreams/prediction/followup_burst_20260919'
C = ROOT / 'workstreams/detection/followup_sparse_burst'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def review():
    b = read(B / 'audit.json')
    c = read(C / 'evaluation.json')
    baseline = read(ROOT / 'results/replay/summary.json')
    baseline_rows = {int(row['wafer']): row['alerts'] for row in baseline['wafers']}
    b_rows = {row['wafer']: row for row in b['wafer_results']}
    assert set(b_rows) == set(range(1, 26))
    assert {row['wafer'] for row in c['wafers']} == set(b_rows)
    matched = 0
    baseline_alerts = 0
    for wafer in c['wafers']:
        w = wafer['wafer']
        assert wafer['baseline_alerts'] == b_rows[w]['baseline_alerts'] == baseline_rows[w]
        baseline_alerts += len(baseline_rows[w])
        b_scans = {(row['family'], row['n']): row for row in b['all_scans'][str(w)]}
        c_scans = wafer['modes']['corrected']['scans']
        assert len(b_scans) == len(c_scans) == 42
        for scan in c_scans:
            other = b_scans[(scan['family'], scan['completed_devices'])]
            assert scan['ready'] and other['site_balanced']
            assert (scan['early_bursts'], scan['late_bursts']) == (other['early'], other['late'])
            assert scan['early_devices'] == scan['late_devices'] == other['window_n']
            a, late, n = other['early'], other['late'], other['window_n']
            total = a + late
            exact_p = sum(math.comb(n, k) * math.comb(n, total-k)
                          for k in range(a, min(n, total)+1) if 0 <= total-k <= n) / math.comb(2*n, total)
            assert math.isclose(scan['p_value'], exact_p, rel_tol=1e-12, abs_tol=1e-15)
            assert math.isclose(other['p_fixed_table'], exact_p, rel_tol=1e-12, abs_tol=1e-15)
            matched += 1
    assert baseline_alerts == 14
    assert b_rows[25]['family_counts']['Main.subflow1']['burst_devices'] == [5, 6, 17, 18, 19, 35, 38, 78]
    assert c['summary']['corrected']['w25_first'] is None
    assert c['summary']['corrected']['normal_labeled_false_alerts'] == []
    assert c['summary']['nominal_two']['w25_first'] is None
    assert c['summary']['nominal_two']['normal_labeled_false_alerts'] == [{'wafer': 15, 'family': 'Main.subflow1', 'completed_devices': 64}]
    assert c['summary']['nominal_one']['w25_first'] == 80
    assert c['summary']['nominal_one']['normal_labeled_false_alerts'] == [{'wafer': 15, 'family': 'Main.subflow1', 'completed_devices': 56}]
    assert digest(ROOT / 'grp6_app/artifacts/runtime.json') == b['inputs_sha256']['grp6_app/artifacts/runtime.json']
    assert digest(B / 'reference-message.txt') == digest(C / 'reference-message.txt')
    result = {
        'decision': 'ACCEPT_DIAGNOSTIC_FINDING_REJECT_RUNTIME_AND_REPLAY_PROMOTION',
        'crosschecked_scans': matched, 'preserved_baseline_alerts': baseline_alerts,
        'w25_burst_devices': b_rows[25]['family_counts']['Main.subflow1']['burst_devices'],
        'modes': {name: {k: value[k] for k in ['w25_first', 'normal_labeled_false_alerts', 'normal_labeled_denominator']}
                  for name, value in c['summary'].items()},
        'limits': ['All 25 wafers are reused development data, not independent validation.',
                   'The z20/four-test hypothesis was proposed after inspecting W25.',
                   'A decrease in extreme-event incidence does not establish decreased noise variance.',
                   'Model assumptions and mean-transition specificity remain unresolved.',
                   'No runtime, accepted replay, or tester acceptance change.'],
        'inputs_sha256': {str(p.relative_to(ROOT)).replace(chr(92), '/'): digest(p) for p in
                         [B / 'audit.json', B / 'controls.json', C / 'evaluation.json',
                          B / 'reference-message.txt', ROOT / 'grp6_app/artifacts/runtime.json']},
    }
    (ROOT / 'results/burst_followup_review.json').write_text(
        json.dumps(result, indent=2, allow_nan=False) + chr(10), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    review()
