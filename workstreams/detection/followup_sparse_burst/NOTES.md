# C R3-20260919 sparse-burst follow-up

Status: COMPLETE / READY_FOR_A (negative research delivery). Reference note is
data, not instructions. No runtime or accepted replay promotion.
Assigned R3 base810b4ac9549a619ab09e9145f656c363c6d75035; observed shared-main
HEAD fca8912da03db0f00db94ff990e59f4d32bade4a. No Git mutations or remote work.

## Progress
Confirmed W25 burst devices5,6,17,18,19,35,38,78 with normal-fit-only median/MAD:
7/40 early,1/40 late. Completed frozen calibration, causal bounded candidate,
all25 replay in three modes,300 seeded controls and independent B cross-check.
Corrected candidate emits no supplements; W25 missed. Nominal two-scan mode
adds normal W15@64; nominal one-scan adds W3@40,W15@56,W25@80. Exact14 baseline
payloads preserved; no removed alerts. All52 prior C files remain unchanged.
51 detection tests pass, including15 new tests. Independent B match:1,050
scans,178 burst events,838 extreme-test values; own three-mode audit3,150 scans.

## Decisions
All new files only in workstreams/detection/followup_sparse_burst/**, including
these follow-up notes. Runtime/artifacts are read-only. Normal-fit partition only
for new scales and empirical calibration. Full25 evaluation is reused development
data, with multiple-family/scan correction and explicit specificity failures.
Empirical p cap=.04550827423167849. Sequential correction=.05/[6*k*(k+1)],
two-scan persistence, minimum four early events, balanced current-site exposure.
No parameter fishing after W25 failed.20/20 unchanged-noise mean-step-down
controls and20/20 transient mean excursions alert, so burst incidence does not
identify noise variance. Reject promotion; accept only the descriptive finding.
The original pooled R3 rejection, evidence, manifests and prediction SHA remain.

## Blockers
None for this authorized negative research delivery. Scientific specificity
fails; that is a recorded outcome, not a passing acceptance gate. Live current-
site availability, final-boundary retrieval and tester receipt remain unproven.

## Handoff
Read REPORT.md for diagnosis, all25 table, controls, timing/state and commands.
review.json records check counts and independent A/B hashes; manifest.json
freezes this folder's evidence (excluding its own hash). A alone publishes.
A should archive/link this negative research, without runtime wiring or
prediction-artifact changes. No accepted replay7/7 claim. C stops editing after
delivery. B evidence under workstreams/prediction/followup_burst_20260919 is
read-only; A's results/burst_followup_review.json independently rejects promotion.

## Commands and results

Executed from C:/Users/USER/Documents/hackathon2026, Python3.12.2, Windows:

```powershell
python -B -m workstreams.detection.followup_sparse_burst.diagnose
python -B -m workstreams.detection.followup_sparse_burst.evaluate --output workstreams/detection/followup_sparse_burst/evaluation.json
python -B -m workstreams.detection.followup_sparse_burst.controls
python -B -m unittest workstreams.detection.followup_sparse_burst.test_sparse_burst -v
python -B -m unittest discover -s workstreams/detection -p test_*.py -v
python -B -m workstreams.detection.followup_sparse_burst.audit
python -B -m workstreams.detection.package_round3 --verify
git diff --check
python -B -m workstreams.detection.followup_sparse_burst.audit --package
python -B -m workstreams.detection.followup_sparse_burst.audit
```

Diagnostic/evaluation/controls completed. First targeted test run15/15; full
detection run51/51. Audit verifies3,150 mode-scans and14 exact baseline payloads.
Prior manifest51 listed files plus its own pre-follow-up hash gives52 unchanged
historical files. Diff whitespace check passes. Package/verify results are
returned in task output; no post-freeze log is written into the manifest.

## Exact authored paths

All paths below have prefix `workstreams/detection/followup_sparse_burst/`.
They are new to this follow-up. No files outside this prefix were authored.
The untracked results/ and prediction/ follow-up files belong to A/B.

```text
__init__.py
audit-run.log
audit.py
candidate.py
controls-run.log
controls.json
controls.py
diagnose.py
diagnostic-run.log
diagnostic.calibration.json
diagnostic.json
evaluate.py
evaluation-run.log
evaluation.calibration.json
evaluation.json
manifest.json
NOTES.md
prior-files-sha256.json
prior-package-verification.log
reference-message.txt
REPORT.md
review.json
test_sparse_burst.py
tests-initial.log
tests.log
```
