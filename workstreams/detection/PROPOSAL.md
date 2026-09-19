# Reject promotion: normal-reference spread-decrease candidate

September 19, 2026. **Keep the machine-running detector unchanged.** This candidate
does not detect W25: expected-category coverage remains **6/7** across all 25 wafers
(2,000 completed devices). It adds two spread-down alerts and measurable scan cost.
This fulfills the offline evaluation; it does not close G3/W25 detection acceptance.

## Reproduce

Run from this checkout's root, using Python with the existing NumPy dependency
(recorded environment: Python 3.12.2, NumPy 2.2.6). No dependency/config changes.

```powershell
python -B -m grp6_app.rehearse source_review/training/Data --output workstreams/detection/evidence/baseline > workstreams/detection/baseline-run.log 2>&1
python -B -m workstreams.detection.evaluate > workstreams/detection/evaluation-run.log 2>&1
python -B -m unittest discover -s workstreams/detection -p test_candidate.py -v > workstreams/detection/test-run.log 2>&1
python -B -m workstreams.detection.verify > workstreams/detection/verification-run.log 2>&1
git diff --check
git diff --name-only eababfc4ffbb6c6faea4136b3dd9724773247aab
git status --short
```

The evaluator recomputes a frozen calibration, runs the unchanged `WaferDetector`
beside the candidate, and checks exact alert equality with the fresh baseline
rehearsal. Only output subdirectories under `workstreams/detection/` are accepted.
The verifier checks all 25 CSV input hashes, runtime/evaluator/candidate hashes,
calibration hash, all baseline alerts, candidate persistence evidence and ownership.
All four Python commands exited 0; 11 behavior tests pass. Source inputs remained
byte-identical. Logs are adjacent to this file.

## One evaluated candidate

`candidate.py` is a stdlib-only streaming proposal with no wafer IDs, labels, bins
or future rows in its input. It receives site plus current completed-device values.
One instance must belong to one externally established run/tester/lot/wafer scope;
unknown sites invalidate that instance. Duplicate/retest/head semantics require
integration work and are not inferred here.

- Freeze per-test/per-site reference SD as the median of 12-device population-SD
  windows on the existing 13 normal-fit wafers: 2,4,5,7,8,10,11,13,16,17,19,20,22.
  Calibration uses prefixes 48,56,64,72,80: 65 windows per site.
- Keep families with at least 20 eligible tests; all normal windows must be finite
  and nonconstant at every site. This yields 3,024 tests across seven families and
  four sites. No test is selected for its W25 behavior.
- After 48 completed devices and at least 12 observations at every configured
  site, scan every eight devices. Count family tests whose current site-window SD
  is at most 0.70 of their frozen reference (at least a 30% decrease).
- Require at least three hits and a fraction strictly above the larger of 0.05 or
  the normal-fit maximum hit fraction plus 0.02. Learned site/family thresholds
  range from 0.122 to 0.3116667. Require two consecutive eligible scans with fresh
  site observations; missing/nonfinite windows reset that family's streak.
- Emit once per site/family per instance. Fixed deques retain 12 values per test;
  supported capacity is capped at 4,096 tests and eight sites. The evaluated case
  retains at most 145,152 measurement slots. Finalization cannot add a persistence
  vote or bypass sample requirements. Scan work is O(sites × tests × window).

Normal fitting is offline and label-informed through the inherited normal-fit
partition. The current evaluation wafer never adapts its reference or thresholds.
All wafers were already inspected; even W6/12/15/21/24 are reused development checks.
Before implementation, W25 per-site SD relative to normal minimum SD was inspected
for full sequences and windows of 8/12 devices. This influenced choosing a normal
median reference plus a calibrated family gate. No independent validation or
generalization is claimed. Overlapping windows and related tests are dependent;
the fraction gate is not a statistical false-alarm probability or guarantee.

## All-wafer comparison

`@N` means first alert at N completed devices, not delay since anomaly onset.
Exact onset is unknown. The combined policy preserves every baseline alert and
appends every candidate alert, including same-category duplicates.

| Wafer | Evaluation label | Unchanged baseline alerts | Candidate additions | Baseline / combined count |
| --- | --- | --- | --- | --- |
| 1 | site_imbalance | site_imbalance@32 | spread_down@56 | 1 / 2 |
| 2 | normal | low_yield@32 | none | 1 / 1 |
| 3 | low_yield | low_yield@32 | none | 1 / 1 |
| 4 | normal | none | none | 0 / 0 |
| 5 | normal | none | none | 0 / 0 |
| 6 | normal | none | none | 0 / 0 |
| 7 | normal | none | none | 0 / 0 |
| 8 | normal | none | none | 0 / 0 |
| 9 | low_yield | low_yield@72 | none | 1 / 1 |
| 10 | normal | none | none | 0 / 0 |
| 11 | normal | none | none | 0 / 0 |
| 12 | normal | none | none | 0 / 0 |
| 13 | normal | none | none | 0 / 0 |
| 14 | mean_drift_up | mean_drift_up@32, mean_drift_down@56, spread_down@64 | none | 3 / 3 |
| 15 | normal | none | none | 0 / 0 |
| 16 | normal | none | none | 0 / 0 |
| 17 | normal | none | none | 0 / 0 |
| 18 | mean_drift_down | mean_drift_down@32, mean_drift_up@56, spread_down@64 | none | 3 / 3 |
| 19 | normal | none | none | 0 / 0 |
| 20 | normal | none | none | 0 / 0 |
| 21 | normal | none | none | 0 / 0 |
| 22 | normal | none | none | 0 / 0 |
| 23 | spread_up | mean_drift_up@32, mean_drift_down@32, spread_up@40, spread_down@72 | spread_down@80 | 4 / 5 |
| 24 | normal | none | none | 0 / 0 |
| 25 | spread_down | none | none | 0 / 0 |

Expected-category coverage: site imbalance 1/1, low yield 2/2, mean up 1/1, mean down
1/1, spread up 1/1, spread down 0/1 for both policies. Total alerts increase from
14 to 16; no baseline alert or detection position regresses. Category counts
before/after are respectively 1/1, 3/3, 3/3, 3/3, 1/1, 3/5.

Normal-label false-alarm proxy: **1/18 wafers (5.56%), one alert**, unchanged. That
wafer is W2: measured SBin-derived yield is 53.75%, so its low-yield alert is valid
and must not be suppressed. The other 17 normal-labeled wafers have zero alerts.
The candidate adds zero normal-labeled alerts. W1/W23 additions are unadjudicated
extra categories; they are not evidence of improved category accuracy. W23 already
has a baseline spread-down alert, so its addition is also a duplicate category.

## Evidence and cost

All added alerts, original alerts, W25 failed scans and complete per-scan diagnostics
are retained in `evidence/evaluation/representative-evidence.json` and
`candidate-scans.jsonl`; the full all-wafer comparison is `metrics.json`.

| Added alert | Site/family | Count | Hits | Family score | Representative observed/reference SD |
| --- | --- | ---: | ---: | ---: | --- |
| W1 spread_down | 2 / Main | 56 | 6/24 | 1.3393 | 0.0255869 / 0.0491780 |
| W23 spread_down | 3 / Main.subflow2 | 80 | 75/500 | 1.2295 | 0.0238658 / 0.0516140 |

W25's strongest scan is site 2 / Main at device 56: 3/24 hits (0.125) versus the
0.1866667 gate, score 0.66964, persistence zero. No scan passes its family gate.
Do not lower a threshold just to fit this label. Evidence carries original values,
per-site window series, within-site completed-device indices, direction, baseline
provenance, score semantics and a suggestion to check clipping/stale results/range
changes. These are source CSV units, not verified physical units; scores are not
probabilities, and suggested causes are not established diagnoses.

| Local operation | Samples | Median ms | p95 ms | Max ms |
| --- | ---: | ---: | ---: | ---: |
| Baseline analyze (24+ devices) | 200 | 86.26 | 112.96 | 194.66 |
| Candidate eligible analyze (48+ devices) | 125 | 94.50 | 109.33 | 159.55 |
| Candidate add | 2,000 | 1.31 | 1.93 | 4.42 |
| Serial baseline + candidate analyze | 200 | 179.25 | 222.01 | 329.10 |

Single Windows replay, no SDK callback or machine deadline test. Parsing, baseline
add and I/O are excluded from scan timing. Initial `statistics.pstdev` arithmetic
had candidate p95 719.13 ms; a two-pass calculation around a local origin reduced
that cost without changing alert outcomes. The earlier timings/code hashes are
explicit historical evidence in `initial-performance.json`; current source hashes
and timings are in `metrics.json`.

## Provenance and A handoff

Base: `eababfc4ffbb6c6faea4136b3dd9724773247aab`; branch: `team/c-detection`.
Runtime artifact SHA256:
`752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`.
Frozen calibration SHA256 (canonical JSON excluding its own hash field):
`da3a2b139cfaf1e4b7f9faae218f206f402901f9a81e22b4d458621e51dd64ee`.
All 25 CSV SHA256 values and evaluated source hashes are in `metrics.json`;
normal window origins, exact gates and references are in `calibration.json`.
Evaluated Python source hashes normalize CRLF to LF for Git checkout portability;
input file hashes retain exact bytes.
`evaluation_head_sha` names the checkout HEAD before uncommitted implementation;
the evaluated source hashes identify the actual code. Git history identifies the
final committed handoff.

No runtime integration is requested for this rejected candidate. A owns any future
change to `grp6_app/runtime.py` (detector integration), `grp6_app/artifacts/runtime.json`
(reviewed calibration promotion), `grp6_app/monitor.py` (scope/reset/callback costs),
and `SYSTEM.md` (canonical G3 outcome). Those paths remain untouched. A should keep
G3 open, retain this negative result, and require independent normal/anomalous lots,
verified measurement semantics and machine load checks before considering promotion.
