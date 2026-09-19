# C sparse-burst follow-up: diagnostic confirmed; promotion rejected

READY_FOR_A, R3-20260919, September 19, 2026. The note changes the description
of W25 to a plausible **decline in sparse extreme-event incidence**. It does not
establish a broad reduction in noise variance or an acceptable detector.
The corrected causal candidate misses W25. Relaxing correction/persistence
adds a normal-labeled false alert; unchanged-noise mean-return controls fail
spread specificity. Reject runtime and accepted replay promotion.

All work is offline, in this fresh folder. Assigned base is
`810b4ac9549a619ab09e9145f656c363c6d75035`; observed starting shared-main HEAD is
`fca8912da03db0f00db94ff990e59f4d32bade4a`. No Git mutations, remote access,
paid APIs, runtime/artifact/deployment changes, or new agents. A alone publishes.
The Desktop note is preserved as reference-message.txt, not an instruction source.

## Diagnosis and calibration

The unchanged baseline detector misses W25 because its broad family gates do
not qualify; prior R3/B evidence found no broad absolute-SD decline. The note's
different statistic describes rare simultaneous extremes rather than the spread
of a typical test. Earlier rejected pooled-variance findings remain historical.

Using only artifact normal-fit wafers **2,4,5,7,8,10,11,13,16,17,19,20,22**,
fit a median and 1.4826*MAD for every site/test. There are 260 observations per
site/test, four sites, six families of 500 tests, and no zero-MAD baselines.
All 6,072,000 source measurement cells are finite. For zero MAD the documented
fallback is max(IQR/1.349, population SD, abs(median)*1e-9, 1e-12); the fallback
is unit-tested but unused on these data.

A device/family is a burst when at least four tests have absolute robust z>20.
W25 subflow1 burst PIDs/completed-device indices are **5,6,17,18,19,35,38,78**:
seven in the first40 and one in the last40. Sites are 1,2,1,2,3,3,2,2; each
event contains four or five extreme tests. The eight events contain 39 extreme
test observations across 36 distinct tests. Raw MAD instead of scaled MAD also
reproduces7/1; diagnostic.json retains both conventions and full raw evidence.

The 13 fit wafers contain65 qualifying bursts, all in subflow1. A normal-only
grid z={10,15,20,30,40}, minimum tests={3,4,5,6} does not uniquely select the
note's z20/four-test definition: for z20, counts are70/65/46/0 respectively.
The note proposed its thresholds after seeing W25. We retained that definition
to test the claim; neither thresholds nor the correction were adjusted to force
W25 detection. Normal-only fitting does not undo hypothesis-selection reuse.

## Causal candidate and all25 results

candidate.py accepts only current site and measurements. It reads no wafer ID,
label, pass/bin, final wafer length, or future values. It retains up to80
device records per family, scans at32 and every8 devices, and compares equal
halves of the observed window using a one-sided exact Fisher count test.
It requires at least four early bursts, a decline, full known site layout,
equal site exposure in both halves, at least four observations per site/half,
and two successive passing scans. Missing/nonfinite family measurements retain
their device position and make that window abstain; unknown site invalidates
scope. Inputs and claims require completed devices with all current-site tests.

Normal-only empirical calibration is minimum qualifying normal-fit p /1.2.
W19@48 supplies p=.05460992907801419, yielding **.04550827423167849**.
The corrected mode additionally spends alpha .05/[6*k*(k+1)] at scan k;
the cutoff is the minimum of the empirical cap and that allocation. This has
a union-bound interpretation only if the constituent conditional tests are
valid under event exchangeability. Dependent bursts/site or time structure can
invalidate that assumption. Persistence does not make overlapping scans
independent. This is a research correction, not a calibrated production guarantee.

At W25@72, p=.05326703896317555; at80, p=.028379336979995902.
The respective corrected cutoffs are .0001984126984126984 and
.00014880952380952382. W25 never passes the corrected rule.
Even the uncorrected two-scan rule cannot alert on its single qualifying scan.
Normal W15 instead has5/0 at56 and64, with p=.025728987993138937 and
.026411657559198543. Its last40 split eventually becomes5/1; these are different
prefix windows, not conflicting counts.

Every supplement below is subflow1. A dash means no supplement. All modes
preserve the original baseline payloads separately. Fit/reused describes reuse,
not an independent validation split. Counts are subflow1 first40/last40;
diagnostic.json contains all six families and evaluation.json every scan.

| Wafer | Use | Bursts | Baseline alerts | Corrected two | Nominal two | Nominal one |
| --- | --- | --- | ---: | --- | --- | --- |
| 1 | reused | 4/0 | 1 | - | - | - |
| 2 | fit | 2/3 | 1 | - | - | - |
| 3 | reused | 13/12 | 1 | - | - | 40 |
| 4 | fit | 0/2 | 0 | - | - | - |
| 5 | fit | 4/4 | 0 | - | - | - |
| 6 | reused | 2/4 | 0 | - | - | - |
| 7 | fit | 6/4 | 0 | - | - | - |
| 8 | fit | 1/2 | 0 | - | - | - |
| 9 | reused | 9/15 | 1 | - | - | - |
| 10 | fit | 1/3 | 0 | - | - | - |
| 11 | fit | 4/3 | 0 | - | - | - |
| 12 | reused | 2/0 | 0 | - | - | - |
| 13 | fit | 1/4 | 0 | - | - | - |
| 14 | reused | 3/1 | 3 | - | - | - |
| 15 | reused | 5/1 | 0 | - | 64 | 56 |
| 16 | fit | 2/1 | 0 | - | - | - |
| 17 | fit | 2/3 | 0 | - | - | - |
| 18 | reused | 5/1 | 3 | - | - | - |
| 19 | fit | 4/3 | 0 | - | - | - |
| 20 | fit | 0/1 | 0 | - | - | - |
| 21 | reused | 1/2 | 0 | - | - | - |
| 22 | fit | 1/4 | 0 | - | - | - |
| 23 | reused | 7/4 | 4 | - | - | - |
| 24 | reused | 6/8 | 0 | - | - | - |
| 25 | reused | 7/1 | 0 | - | - | 80 |

Corrected:0 added/0 removed,0/18 normal-labeled wafers with supplements, W25
missed. Nominal two:1 added (W15@64),1/18 normal extras, W25 missed. Nominal
one:3 added (W3@40,W15@56,W25@80),1/18 normal extras; W3's added spread-down
category is not its low-yield label. Label mismatches are not proof that an
unlabeled physical anomaly is absent. None supports accepted replay7/7.
W6/12/15/21/24 have already been inspected and are not holdouts.

All **14 baseline alert payloads match exactly** against the saved baseline
summary, including test/site/score/series, category and original emission time:
W1 site_imbalance32; W2 low_yield32; W3 low_yield32; W9 low_yield72;
W14 mean_drift_up32/mean_drift_down56/spread_down64;
W18 mean_drift_down32/mean_drift_up56/spread_down64;
W23 mean_drift_up32/mean_drift_down32/spread_up40/spread_down72.
W2 retains its valid low-yield alert (53.75% final yield) despite the normal
label. candidate.emitted is wholly separate and cannot suppress baseline output.

## Controls, independent checks and limits

controls.json contains300 seeded streams using six families of20 tests,
four sites,80 devices, standard Gaussian additive noise and fixed oracle
location/scale. They are mechanism controls, not a fitted real-data validation.

| Case | Alerted / streams | First device | Interpretation |
| --- | ---: | --- | --- |
| Strong sparse-burst decline | 20/20 | 40 | Detects sufficiently strong event-count decline |
| Constant-noise mean step down to baseline | 20/20 | 40 | Fails noise-spread specificity |
| Transient mean excursion returning to baseline | 20/20 | 64 | Fails noise-spread specificity |
| Stable regular bursts; burst increase; one extreme test; one impulse; permanent mean step up; constant site offset | 0/20 each | none | Specified negative controls pass |
| Stationary IID bursts | 0/120 | none | Limited synthetic null result only |

The strong-decline and mean-step-down fixtures intentionally generate identical
observations: four tests have a +30 shift on early devices with unchanged
additive noise. A burst indicator alone cannot identify which physical
interpretation caused those observations. The 40/40 mean-return detections are
scientific specificity failures, despite passing characterization unit tests.

B independently reproduces all178 qualifying events and838 extreme-test
measurements, and1,050 family/scan count/p-value comparisons agree (relative
and absolute tolerance1e-12). Our audit additionally verifies3,150 scans across
three comparison modes. B's controls also show correlated-test and changing-site
mix confounds. Our balanced-site guard blocks the demonstrated exposure-mismatch
class, not correlated events or mean returns under balanced exposure. Four
correlated extreme tests do not constitute four independent confirmations.
B's full-fit/leave-one-normal-out calibration result likewise alerts on W15.
The B evidence paths and exact hashes are in review.json.

There is no causal onset ground truth, independent holdout or production
false-positive estimate. Fitting scales and the empirical cutoff on the same
13 normal wafers can overfit them. The z20/four-test hypothesis and window
choices reuse this development corpus. Finite values do not resolve unit,
invalid-bit or retest semantics in live data.

Finalization performs no off-cadence scan and repeated final calls are no-ops.
Unknown/incomplete layout abstains; waiting for full device/family values can
delay eligibility. The uncorrected W25@80 event is at the last device, with no
demonstrated later tester poll or receipt. No Edge timing, callback load,
delivery, live or accepted replay claims follow from this offline work.

## Timing and bounded state

One local measured replay per wafer/mode, fixed mode order, no benchmark warmup
or uncertainty estimate. Corrected-mode current-device robust-z ingestion
(2,000 calls): median1.31495ms, p95=2.210245ms, max27.9561ms. Active scans
(175 calls): median0.2432ms, p95=.40503ms, max.5938ms; sum44.48ms.
The corrected25-wafer detector replay totals3,090.3316ms. Whole evaluation
wall time33.0395664s includes three modes, baseline replay and CSV reading,
but excludes final output serialization. Timings are wall-clock observations
under shared-machine load, not a callback budget or performance acceptance.

Mutable retained reachable state at wafer end:173,113–224,031 bytes (corrected),
excluding shared baselines/layout, transient scans, external alerts, allocator
overhead and peak/RSS. Six80-record deques bound record count at480; each
record retains at most8 illustrative extreme-test values. Counters grow
logarithmically with stream length. Full untruncated evidence lives separately
in diagnostic.json. The frozen calibration JSON is3,474,135 bytes; its decoded
Python object also consumes shared memory not counted as mutable state.

## Reproduction and A handoff

From repository root, verify without writing evidence:

```powershell
python -B -m workstreams.detection.followup_sparse_burst.audit
python -B -m workstreams.detection.package_round3 --verify
python -B -m unittest discover -s workstreams/detection -p test_*.py -v
git diff --check
```

To reproduce data-dependent outputs, use fresh paths (existing outputs are
refused). The evaluator validates and uses the original frozen diagnostic
seed; audit verifies its content and inputs. Timing bytes will vary.

```powershell
python -B -m workstreams.detection.followup_sparse_burst.diagnose --output workstreams/detection/followup_sparse_burst/reproduction/diagnostic.json
python -B -m workstreams.detection.followup_sparse_burst.evaluate --output workstreams/detection/followup_sparse_burst/reproduction/evaluation.json
python -B -m workstreams.detection.followup_sparse_burst.controls --output workstreams/detection/followup_sparse_burst/reproduction/controls.json
```

51 detection tests pass, including15 new tests. Prior R3 manifest verifies51
listed files; the initial follow-up inventory additionally verifies the prior
manifest itself, totaling52 unchanged historical C files. Full code/input and
result hashes are recorded in diagnostic.json, evaluation.json, review.json
and manifest.json. Manifest excludes its own hash. Key SHA256 values:

```text
reference-message.txt 63517c5c848005f5187d5a380ba3ea67f0a43238c75ee83209a73ea0422bb3a3
candidate.py fa893117013f08794330688128f2582d9e69ba2e9bed4c54dde7ab9304122b3e
diagnostic.json 6310c176390b72d48f51ab5ef3b853750dfad67d46f2200994421f9ba109551e
evaluation.json 12779ea4ced843459f105d30c9787ab3641fa7153daff1178736692d48be7968
evaluation.calibration.json 9c635fe9fcaff8f036bcdd57c8f5d119750f526d7c62f7bf95380d5d26148a06
controls.json f245a694024ac445f06a66def5cab9babd20daba241129669bb59dfc0c3ae64c
calibration canonical content 59c7489080cdd729c585557721107553112ef78b0d427f8f381813a2906c0876
unchanged prediction/runtime artifact 752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9
prior R3 manifest f478c310da93ac38765ce4985e90f12a799d164607691cc1b653939ea4f08b04
```

A's minimal integration recipe is to archive this fresh evidence folder and
link the negative diagnostic conclusion from the canonical review. Do not wire
the candidate into runtime, merge calibration into the prediction artifact,
replace baseline alerts, or promote nominal W25@80 to accepted7/7. A's
results/burst_followup_review.json independently records rejection. No source
changes outside this folder are requested. Exact authored paths are in NOTES.md
and manifest.json. C stops editing after READY_FOR_A delivery.
