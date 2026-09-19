"""Write reviewable report, verify protected inputs, and hash diagnostic outputs."""
import csv, hashlib, json, subprocess
from pathlib import Path
ROOT=Path.cwd(); OUT=ROOT/'results/replay_investigation_20260919/model'; NL=chr(10)
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
inputs=read(OUT/'inputs.json'); comp=read(OUT/'category_comparison.json'); reg=read(OUT/'regression_check.json')
current={p:sha(ROOT/p) for p in inputs['sha256']}
changed=[p for p,h in inputs['sha256'].items() if current[p]!=h]
protected=[p for p in inputs['sha256'] if p.startswith(('grp6_app/','results/replay/','source_review/')) or p=='Question_20260919.pdf']
assert not set(changed)&set(protected), changed
assert comp['preservation']['accepted_alert_payloads_identical']
assert comp['preservation']['candidate_preserves_all_core_payloads']
assert comp['metrics']['baseline']['expected_category_hits']==6
assert comp['metrics']['candidate']['expected_category_hits']==7
assert reg['fresh_flow_stages_match_saved']
assert all(s['all_selected_features_causal'] and s['feature_selection_matches_rebuild'] for s in reg['stages'].values())
assert all(s['max_abs_rebuilt_parameter_difference']<1e-12 for s in reg['stages'].values())
verification={'protected_input_files':len(protected),'all_protected_hashes_unchanged':True,'other_input_changes_by_concurrent_workers':changed,
              'head_start':inputs['head'],'head_finish':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'checks':'all 25 wafer comparisons, 14 accepted payloads, preserved candidate core payloads, flow causality, reproduced model features/parameters',
              'scope':'local CSV investigation only; no remote/browser/runtime promotion'}
(OUT/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
commands=[
    "$py = 'C:/Users/Aquatic/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'",
    '& $py -B results/replay_investigation_20260919/model/prepare.py',
    '& $py -B -m grp6_app.rehearse source_review/training/Data --output results/replay_investigation_20260919/model/baseline --artifacts results/replay_investigation_20260919/model/baseline_artifacts > results/replay_investigation_20260919/model/baseline.log',
    '& $py -B -m grp6_app.rehearse source_review/training/Data --output results/replay_investigation_20260919/model/candidate --artifacts results/replay_investigation_20260919/model/candidate_artifacts > results/replay_investigation_20260919/model/candidate.log',
    '& $py -B -m grp6_app.build_models source_review --output results/replay_investigation_20260919/model/regression_rebuild > results/replay_investigation_20260919/model/regression_rebuild.log',
    '& $py -B results/replay_investigation_20260919/model/analyze.py > results/replay_investigation_20260919/model/analysis.log',
    '& $py -B results/replay_investigation_20260919/model/trajectories.py > results/replay_investigation_20260919/model/trajectories.log',
    '& $py -B results/replay_investigation_20260919/model/finish.py',
]
(OUT/'commands.ps1').write_text(NL.join(['# Run from C:/Users/Aquatic/Documents/Hackathon_YJSNPI',
    '# Recorded successful computation sequence. prepare.py intentionally refuses existing artifact directories.',
    '# Do not rerun into this retained evidence directory; use a fresh isolated root if repeating.']+commands)+NL,encoding='utf-8')
table=['| Wafer | PDF category | Yield | Baseline categories @ device | Candidate difference |',
       '| --- | --- | ---: | --- | --- |']
for e in comp['wafer_comparison']:
    alerts=', '.join(a['kind']+'@'+str(a['device']) for a in e['baseline']['alerts']) or 'none'
    table.append('| W'+str(e['wafer'])+' | '+e['pdf']+' | '+format(e['yield'],'.2%')+' | '+alerts+' | '+('adds spread_down@72' if e['wafer']==25 else 'unchanged')+' |')
with (OUT/'wafer_comparison.csv').open('w',newline='',encoding='utf-8') as f:
    writer=csv.writer(f); writer.writerow(['wafer','pdf_category','yield','baseline','candidate','baseline_extra','baseline_missing','baseline_exact','candidate_exact'])
    for e in comp['wafer_comparison']: writer.writerow([e['wafer'],e['pdf'],e['yield'],json.dumps(e['baseline']['alerts']),json.dumps(e['candidate']['alerts']),','.join(e['baseline']['extra']),','.join(e['baseline']['missing']),e['baseline']['exact'],e['candidate']['exact']])
lines=['# Detector and temperature-model investigation',
       'Local run completed September 20, 2026 Asia/Taipei; requested evidence directory retains 20260919. Source HEAD: '+inputs['head']+'. Parent reports VPS REVISION 14ff55bfd31694e49ff324564b13c0535d16fe9a and grp6 booted for pinned-baseline testing. Those remote observations were not independently checked in this local investigation.',
       'Read AGENTS.md, SYSTEM.md and the project ADHD skill. Read-only PDF extraction plus rendered pages 3 and 4 verified the category table and causal training constraint. No remote access, browser, accepted replay overwrite, source edit or promotion.',
       '## Findings',
       'W2 is a source-data/PDF-label conflict, not a demonstrated CSV parsing or wafer identity bug. W25 is a reproducible baseline miss and a separately reproducible current-source supplement hit. The local frontend bundled summary still contains the baseline miss.',
       '### W2: raw independent audit',
       '80 device rows, 3,046 columns each, four metadata rows skipped. All rows: lot A12345, wafer 2; 80 unique PIDs, no duplicate PID/site pairs; sites 1-4 each have 20 devices. SBin and HBin both: 1=43, 3=32, 6=5. PF: 0=43, 8=37. Exact joint counts: PF0/SBin1/HBin1=43; PF8/SBin3/HBin3=32; PF8/SBin6/HBin6=5. No bin/PF inconsistency. Site pass counts: 11/20, 14/20, 8/20, 10/20.',
       'DefineBins.java explicitly defines hard and soft bin 1 PASS and bins 2-32 FAIL. Therefore measured yield is 43/80 = 53.75%. At first alert, 20/32 = 62.5%, Wilson one-sided upper bound 75.0787%, below the 80% rule. The first eligible scan is 32 devices. The PDF page-3 table says W2 Normal. Suppressing this alert to fit the label would contradict the supplied bin data. PF is corroboration; yield is computed from SBin, not an assumed PF bit decoder. No separate encoded wafer-id measurement column exists in these CSVs.',
       'All 25 CSVs have matching filename/internal wafer identity, consistent SBin/HBin/PF pass status and 80 devices each. The 2,000 x 3,036 numeric measurement matrix contains no missing/nonfinite values. See raw_data_audit.json and w02_raw_device_metadata.csv.',
       '### W25: miss versus current supplement',
       'Baseline produces zero W25 alerts, matching accepted replay exactly. Candidate produces spread_down@72 with all 14 baseline payloads unchanged. The family is Main.subflow1 (500 tests). Core site-averaged log-spread q80 at device 72 is 0.188246 versus gate 0.357667 (ratio 0.5263); only two individual tests exceed their per-test spread-down thresholds. Its family gate stays below threshold across scans 32-80. The median geometric recent/early SD ratio at 72 is 0.98145. Sparse extreme events are diluted by the core family aggregation.',
       'Candidate burst devices in full W25: 5,6,17,18,19,35,38,78. At 72: 6/36 early versus 1/36 recent, exceeding fitted early floor 5, Fisher p=0.0532670 <= configured alpha 0.10. At 80: 7/40 versus 1/40, floor 6, p=0.0283793. A burst means at least four tests above absolute robust z=20 within a family. This detects declining extreme-event incidence; it does not independently establish a general noise-variance decrease.',
       'frontend/public/replay/summary.json equals accepted results/replay/summary.json byte-for-byte, SHA256 f086d2c6887aef9fd34e7804c7e56de36f826d71b49e3927e7261913487d856c. W25 in it: yield 0.9, expected spread_down, expected_first_device null, alerts []. Thus historical candidate success and a frontend with no W25 alert can coexist because they use different evidence. This investigation establishes the local saved-data difference only; the frontend worker owns visual wording and the live worker owns deployed behavior.',
       '### Ground-truth agreement and all extra categories',
       'Treat the PDF table as an exhaustive single-category label for this scoring calculation; normal means no category. Count each wafer/category pair once. These are label-relative false positives, not proof that every additional measured effect is physically false.',
       '| Metric | Baseline | Candidate |','| --- | ---: | ---: |',
       '| Expected categories found | 6/7 (85.71%) | 7/7 (100%) |',
       '| Alerts / extra categories / missing categories | 14 / 8 / 1 | 15 / 8 / 0 |',
       '| Category precision | 42.86% | 46.67% |',
       '| Category F1 | 57.14% | 63.64% |',
       '| Exact wafer category sets | 20/25 (80%) | 21/25 (84%) |',
       '| Normal-label wafers alerted | 1/18 (5.56%), W2 | 1/18 (5.56%), W2 |',
       'The 8 extras are W2 low_yield; W14 mean_drift_down and spread_down; W18 mean_drift_up and spread_down; W23 mean_drift_up, mean_drift_down and spread_down. Candidate adds only the expected W25 category. The other 17 normal-label wafers produce no alerts.',
       'W14 and W18 trajectories include transient excursions and recovery: representative W14/site4 means in consecutive groups of four site devices are 1.2545, 1.50625, 1.13175, 1.1085, 1.0825; W18/site4 are 1.57175, 1.13325, 1.6055, 1.637, 1.648. Prefix-half comparison therefore sees both the initial direction and recovery direction. Spread comparisons also include that nonstationary excursion, so a later spread-down alert is not isolated evidence of reduced intrinsic noise.',
       'W23 has opposite-direction sample-mean movements on different representative tests/sites during its spread excursion. The core uses one unsigned family mean-change gate for both signs: q80 max absolute change=1.61559 vs gate=1.60259, just 1.0081x, allowing both directional per-test alerts. Direction-specific diagnostic q80 values are only 1.21626 and 1.29180; these do not reach that same gate. This is a concrete cross-category mechanism, not temperature regression. Later windows also compare the earlier noisy interval against quieter data, producing spread_down. No threshold change was made.',
       '## All 25 wafers',*table,
       '## Temperature regression is a separate task',
       'Rehearse ran all six RuntimeModels.predict paths on all 2,000 devices (12,000 predictions per variant). Rebuilt all six models and five wafer-separated folds from CSVs and nested TP flow source into regression_rebuild/. All selected feature lists match the existing models, all are causally eligible, and maximum numeric parameter difference is 3.45e-15 or less. Eligible feature counts: 25,525,1025,1525,2025,2525; selected counts: 25,32,32,32,32,32. No target sensor, final bin, PF or wafer label is a regression feature.',
       'The table below contains freshly recomputed out-of-fold metrics (2,000 targets per stage). Replay fitted MAE is recorded separately in regression_check.json and is not held-out accuracy.',
       '| Stage | Held-out MAE | RMSE | Training-mean baseline MAE | Worst absolute error |','| --- | ---: | ---: | ---: | ---: |']
for stage,s in reg['stages'].items():
    m=s['recomputed_heldout_metrics']; lines.append('| '+stage+' | '+' | '.join(format(m[k],'.6f') for k in ['mae','rmse','baseline_mae','worst_error'])+' |')
lines += ['The six Ridge models predict the six sensor values, not wafer categories. Low-yield alerts use device bins; parametric alerts use raw measurement statistics and calibrated thresholds; the sparse supplement uses robust extreme counts. Changing the supplement leaves temperature predictions identical.',
          '## Limits',
          'All 25 wafers were reused during detector development; neither the 17/18 normal-label agreement nor 7/7 candidate recall is independent deployment validation. Historical reports describe scan-start and calibration sensitivity (W15 at 56, leave-W07-out effects); these sensitivity experiments and older rejected candidates were not rerun here. This run does reproduce current candidate behavior across every wafer.',
          'The PDF specifies temperature targets and causal timing but no numeric accuracy tolerance or verified physical units. Metrics remain CSV units. Grouped regression cross-validation is wafer-separated but drawn from one supplied training dataset. No live timing, tester receipts, power state, deployment identity or frontend browser rendering was tested. Local maximum scan observations (baseline 88.2461 ms, candidate 108.8915 ms) came from concurrent runs; they are not a controlled performance comparison and exclude add() cost.',
          'No model/detector change or promotion is proposed from this evidence. The rebuild runtime artifact contains freshly fitted uncalibrated detector baselines and is diagnostic only; replay used frozen copies of the accepted calibrated runtime artifact.',
          '## Reproduction and hashes',
          'Working directory: C:/Users/Aquatic/Documents/Hackathon_YJSNPI. Exact successful computation commands are in commands.ps1; Python was the bundled executable because the system Python lacks NumPy/PDF libraries. Python -B prevented bytecode writes. All authored files are under results/replay_investigation_20260919/model/. prepare.py intentionally refuses existing copied-artifact folders to protect evidence. Original artifact and accepted replay hashes were rechecked after computation and are unchanged.',
          'Input SHA256 values below identify original bytes; inputs.json includes all 25 CSVs, source modules, flow files and accepted replay files. outputs.sha256.json records diagnostic output hashes.',
          '| Input | SHA256 |','| --- | --- |']
for p in ['Question_20260919.pdf','source_review/training/Data/A12345_W02_RawResult.csv','source_review/training/Data/A12345_W25_RawResult.csv','grp6_app/artifacts/runtime.json','grp6_app/artifacts/sparse_burst.json','results/replay/summary.json']:
    lines.append('| '+p+' | '+inputs['sha256'][p]+' |')
lines += ['Additional read-only source: source_review/SmarTest/Case_Smt870/src/common/DefineBins.java SHA256 '+sha(ROOT/'source_review/SmarTest/Case_Smt870/src/common/DefineBins.java')+'.',
          'Evidence files: category_comparison.json / wafer_comparison.csv; raw_data_audit.json / w02_raw_device_metadata.csv; baseline/summary.json / candidate/summary.json and replay.jsonl/report.html; alert_diagnostics.json; representative_trajectories.json; w25_core_family_scans.json; sparse_burst_scans.json; regression_check.json / regression_rebuild/validation.json (full wafer/site metrics); question_page_3.png and question_page_4.png; inputs.json and verification.json.']
(OUT/'REPORT.md').write_text(NL.join(lines)+NL,encoding='utf-8')
outputs={p.relative_to(OUT).as_posix():sha(p) for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='outputs.sha256.json'}
(OUT/'outputs.sha256.json').write_text(json.dumps(outputs,indent=2),encoding='utf-8')
print(json.dumps({'verification':verification,'report_sha256':sha(OUT/'REPORT.md'),'output_file_count':len(outputs)},indent=2))
