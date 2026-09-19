"""Read-only audit; default input round3/evaluation.json, no files written.
Checks hashes, historical baseline identity, alert accounting, and recorded
control outcomes. A passing evidence audit does NOT mean controls passed.
"""
import argparse
import json
from pathlib import Path

from .evaluate_round3 import OWNED, ROOT
from .profile_detector import canonical, digest, value_digest


def audit(path):
    report = json.loads(Path(path).read_text(encoding='utf-8'))
    for name, expected in report['source_and_input_sha256'].items():
        if digest(ROOT / name) != expected:
            raise AssertionError('Provenance mismatch: ' + name)
    calibration = dict(report['calibration'])
    expected = calibration.pop('calibration_sha256')
    assert value_digest(calibration) == expected
    companion = Path(path).with_name(Path(path).stem + '.calibration.json')
    assert canonical(json.loads(companion.read_text())) == canonical(report['calibration'])
    oracle = {r['wafer']: r['alerts'] for r in json.loads((OWNED / 'evidence/baseline/summary.json').read_text())['wafers']}
    assert {r['wafer'] for r in report['wafers']} == set(range(1, 26))
    assert sum(r['devices'] for r in report['wafers']) == 2000
    for wafer in report['wafers']:
        assert canonical(wafer['baseline_alerts']) == canonical(oracle[wafer['wafer']])
        assert wafer['removed_alerts'] == []
        assert wafer['suppressed_candidate_alerts'] == []
        assert canonical(wafer['added_alerts']) == canonical(wafer['candidate_raw_alerts'])
        expected_combined = sorted(wafer['baseline_alerts'] + wafer['added_alerts'], key=lambda a: a['completed_devices'])
        assert canonical(expected_combined) == canonical(wafer['combined_alerts'])
    assert sum(len(r['baseline_alerts']) for r in report['wafers']) == 14
    assert sum(len(r['added_alerts']) for r in report['wafers']) == 6
    assert sum(r['expected_first_device'] is not None for r in report['wafers']) == 7
    synthetic = report['synthetic']
    assert len(synthetic['results']) == 240
    failures = [r for r in synthetic['results'] if not r['matched_expectation']]
    assert len(failures) == 20
    assert {r['mode'] for r in failures} == {'location_step'}
    print('PASS: exact source/input hashes, frozen calibration, 25 wafers/2000 devices, all14 original alerts unchanged, six supplementary alerts, zero removed.')
    print('RESEARCH GATE FAIL: 20/20 constant-variance location-step false positives; 220/240 controls meet expectations. Reject promotion. Diagnostic category matching7/7 is not accepted replay performance.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=OWNED / 'round3/evaluation.json')
    audit(parser.parse_args().input)
