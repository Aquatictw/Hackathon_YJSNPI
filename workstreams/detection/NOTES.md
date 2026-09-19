# C — Detection notes

## Progress

- Offline assignment complete, September 19, 2026: candidate, evaluator, all-wafer comparison, evidence and rejection recommendation in `PROPOSAL.md`.
- Fresh baseline and candidate comparison cover 25 wafers / 2,000 devices. Both detect 6/7 expected categories; W25 remains missed. All baseline alerts/positions preserved, including W2's valid 53.75%-yield finding. Candidate adds spread_down on W1@56 and W23@80; no added normal-labeled alerts.
- Own checkout: `C:/Users/USER/Documents/hackathon2026-c-detection`; initial status was clean. All authored files are under `workstreams/detection/`; no runtime/artifact/results/config/VM changes.

## Decisions

- **Reject promotion.** W25 coverage does not improve, two unadjudicated extra alerts occur, and scan overhead increases. G3 stays open.
- Frozen normal-fit calibration; per-site 12-device windows, 30% minimum SD reduction, family count/fraction gates and two fresh consecutive scans. All 25 wafers are reused development data; no independent holdout/generalization claim. Exact onset and physical units remain unknown.
- Candidate receives only current device measurements and site; calibration uses inherited normal-fit wafers only. Evidence preserves source units, completed-device axes, detector scores and all additional alerts.

## Blockers

- No blocker to delivering this evaluated negative result. W25 improvement, independent validation and machine callback latency remain unproved.
- Outside scope / owner A: `SYSTEM.md` for canonical G3 outcome; any future `grp6_app/runtime.py`, `grp6_app/artifacts/runtime.json`, `grp6_app/monitor.py` integration/calibration/lifecycle work. No production edit requested for this rejected candidate; those paths remain untouched.

## Handoff

- Branch: `team/c-detection`; base SHA: `eababfc4ffbb6c6faea4136b3dd9724773247aab`.
- The implementation commit is the commit containing these notes; resolve with `git log -1 --format=%H -- workstreams/detection/NOTES.md`. Final branch/commit and push result are reported to A in the task response.
- Deliverables: `candidate.py`, `evaluate.py`, `test_candidate.py`, `verify.py`, `PROPOSAL.md`; `evidence/baseline/` contains fresh rehearsal; `evidence/evaluation/` contains calibration, metrics, every scan, representative series and historical initial timings. Input/code SHA256 and environment are in `metrics.json`; calibration SHA256 is `da3a2b139cfaf1e4b7f9faae218f206f402901f9a81e22b4d458621e51dd64ee`.
- Exact verification commands from checkout root:

```powershell
python -B -m grp6_app.rehearse source_review/training/Data --output workstreams/detection/evidence/baseline > workstreams/detection/baseline-run.log 2>&1
python -B -m workstreams.detection.evaluate > workstreams/detection/evaluation-run.log 2>&1
python -B -m unittest discover -s workstreams/detection -p test_candidate.py -v > workstreams/detection/test-run.log 2>&1
python -B -m workstreams.detection.verify > workstreams/detection/verification-run.log 2>&1
git diff --check
git diff --name-only eababfc4ffbb6c6faea4136b3dd9724773247aab
git status --short
```

- Results: rehearsal/evaluation exited 0; 11 behavior tests passed; evidence audit passed baseline equality, all input/code/calibration hashes, W2 preservation, W25 miss, counts/persistence/axes and changed/untracked allowlist checks. No behavior check failures. `git diff --check` passed. Logs above are evidence; `PROPOSAL.md` gives measured timing and the 25-wafer comparison.
- Next action for A: review `PROPOSAL.md`, retain the rejected candidate as development evidence, and leave production thresholds unchanged.
