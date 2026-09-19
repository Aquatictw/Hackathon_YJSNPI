"""Package or verify the rejected R3 research evidence, without rerunning tuning.
Defaults: round3/evaluation.json -> round3/manifest.json with adjacent review.json
and INVENTORY.md. Output is restricted to round3; refuses existing outputs.
--verify reads the manifest and all listed files without writing. No Git writes.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

from .evaluate_round3 import BASE, OWNED, ROOT, key, output_path, relative
from .profile_detector import canonical, digest, timings, value_digest


def verify(path):
    manifest = json.loads(path.read_text(encoding='utf-8'))
    for name, record in manifest['files'].items():
        if digest(ROOT / name) != record['sha256']:
            raise AssertionError('Manifest mismatch: ' + name)
    print('PASS: %d workstream files match manifest; manifest excludes its own hash.' % len(manifest['files']))
    print('Status READY_FOR_A; research recommendation REJECT, scientific controls FAILED.')


def package(path):
    review_path, inventory_path = path.with_name('review.json'), path.with_name('INVENTORY.md')
    if any(p.exists() for p in (path, review_path, inventory_path)):
        raise ValueError('Refusing to overwrite package; use a fresh round3 subdirectory')
    evidence = OWNED / 'round3/evaluation.json'
    report = json.loads(evidence.read_text(encoding='utf-8'))
    oracle_path = OWNED / 'evidence/baseline/summary.json'
    oracle = {r['wafer']: r['alerts'] for r in json.loads(oracle_path.read_text())['wafers']}
    review = {'round': 'R3-20260919', 'status': 'READY_FOR_A',
        'recommendation': 'REJECT production/core promotion; preserve negative research only',
        'accepted_replay_7_of_7': False, 'scientific_controls_pass': False,
        'reason': '20/20 unchanged-variance mean-step controls incorrectly emit spread_down; A accepted negative research delivery, no further tuning',
        'assigned_base': BASE, 'evaluation_observed_head': report['observed_head'],
        'publication': 'A alone publishes; C implementation identified by per-file hashes, no C commit',
        'evidence_sha256': digest(evidence),
        'calibration_file_sha256': digest(evidence.with_name('evaluation.calibration.json')),
        'calibration_content_sha256': report['calibration']['calibration_sha256'],
        'baseline_preservation': [{'wafer': w['wafer'],
            'historical_alerts_sha256': value_digest(oracle[w['wafer']]),
            'current_alerts_sha256': value_digest(w['baseline_alerts']),
            'exact_payload_equal': canonical(oracle[w['wafer']]) == canonical(w['baseline_alerts']),
            'baseline_signatures': [key(a) for a in w['baseline_alerts']],
            'added_supplementary_signatures': [key(a) for a in w['added_alerts']],
            'removed_signatures': [], 'expected': w['expected'],
            'diagnostic_expected_first_device': w['expected_first_device']} for w in report['wafers']],
        'combined_wall_cost_ms': {phase: timings([a+b for w in report['wafers']
             for a,b in zip(w['samples_ms']['baseline'][phase], w['samples_ms']['candidate'][phase])])
             for phase in ('active_scan', 'scheduled_scan', 'add')},
        'state_bytes': {'candidate_min': min(w['state']['candidate']['reachable_mutable_bytes'] for w in report['wafers']),
                        'candidate_max': max(w['state']['candidate']['reachable_mutable_bytes'] for w in report['wafers']),
                        'baseline_min': min(w['state']['baseline']['reachable_mutable_state_bytes'] for w in report['wafers']),
                        'baseline_max': max(w['state']['baseline']['reachable_mutable_state_bytes'] for w in report['wafers'])},
        'control_outcomes': report['synthetic']['by_mode'],
        'base_input_equivalence': {}, 'independent_review': {}}
    for name in ('grp6_app/runtime.py', 'grp6_app/rehearse.py', 'grp6_app/artifacts/runtime.json'):
        base = subprocess.check_output(['git', 'show', BASE + ':' + name], cwd=ROOT)
        current = (ROOT / name).read_bytes()
        review['base_input_equivalence'][name] = {
            'normalized_lf_equal': base.replace(b'\r\n', b'\n') == current.replace(b'\r\n', b'\n'),
            'evaluation_exact_bytes_sha256': report['source_and_input_sha256'][name]}
    for name in ('workstreams/prediction/round3/diagnostics.json',
                 'workstreams/prediction/round3/acceptance-matrix.json',
                 'workstreams/prediction/round3/pooled-challenge.json',
                 'results/r3_research_review.json'):
        p = ROOT / name
        if p.exists():
            review['independent_review'][name] = digest(p)
    assert all(w['exact_payload_equal'] for w in review['baseline_preservation'])
    assert all(v['normalized_lf_equal'] for v in review['base_input_equivalence'].values())
    path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(review, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    files = sorted(p for p in OWNED.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p != path)
    external = [ROOT / 'SYSTEM.md', ROOT / 'AGENTS.md', ROOT / 'prompts/TEAMMATE.md', ROOT / 'team/C_DETECTION.md']
    texts = {}
    for p in files + external:
        try:
            texts[p] = p.read_text(encoding='utf-8-sig')
        except UnicodeError:
            # PowerShell logs can be UTF16. Their hashes still preserve raw bytes.
            try:
                texts[p] = p.read_text(encoding='utf-16')
            except UnicodeError:
                pass
    lines = ['# R3 workstream inventory', '',
        'Every workstream file is retained. Manifest records raw SHA256 and byte size; no historical cleanup occurred.',
        'References below are textual mentions (relative path, basename, or Python module stem) in workstream text and canonical project/assignment documents. They are discoverability aids, not proof of execution. Directory/glob consumers are noted separately.',
        'All test_*.py files are consumed by unittest discovery. All files are consumed by package_round3 manifest verification. R1/R2 files retain their historical meaning.', '',
        '| File | Role | Textual references |', '| --- | --- | --- |']
    for p in sorted(set(files + [inventory_path, path])):
        rel = p.relative_to(OWNED).as_posix()
        role = ('R3 generated inventory/manifest' if p in (inventory_path, path) else
                'Historical R1/R2 evidence or implementation' if not rel.startswith('round3/') and p.name not in
                ('NOTES.md', 'ROUND3.md', 'pooled_candidate.py', 'evaluate_round3.py', 'diagnose_round3.py',
                 'synthetic_round3.py', 'test_pooled_candidate.py', 'audit_round3.py', 'package_round3.py') else
                'Historical R2 evidence' if rel.startswith('round2/') else
                'Exploratory snapshot; not final acceptance' if 'exploration' in p.name else 'R3 research delivery')
        refs = [relative(q) for q, content in texts.items() if q != p and
                (rel in content or p.name in content or (p.suffix == '.py' and p.stem in content))]
        lines.append('| `' + rel + '` | ' + role + ' | ' + (', '.join('`'+r+'`' for r in refs) or 'directory/glob consumers only') + ' |')
    inventory_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    files = sorted(p for p in OWNED.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p != path)
    manifest = {'round': 'R3-20260919', 'generated_utc': datetime.now(timezone.utc).isoformat(),
                'assigned_base': BASE, 'status': 'READY_FOR_A',
                'exclusions': ['manifest itself (self-hash impossible)', '__pycache__ generated interpreter cache'],
                'files': {relative(p): {'sha256': digest(p), 'bytes': p.stat().st_size} for p in files}}
    path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    verify(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(OWNED / 'round3/manifest.json'))
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    path = output_path(args.output)
    verify(path) if args.verify else package(path)
