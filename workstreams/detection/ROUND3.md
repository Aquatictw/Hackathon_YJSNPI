# C R3-20260919 — rejected temporal spread-decrease research

**READY_FOR_A. Recommendation: REJECT promotion.** The supplementary detector finds W25 at device80, but incorrectly emits on all20 constant-variance mean-step controls. A accepted this negative research delivery and requested no further tuning. Apparent category matching on seven labeled development wafers is **not accepted replay7/7 performance**. Keep current runtime and prediction artifact unchanged.

Assigned published base: `810b4ac9549a619ab09e9145f656c363c6d75035`. Shared `main`; observed evaluation HEAD `bd47d4d54f19a23ba9e98abc658dd4089508969b` reflects A's concurrent work. Exact evaluated source/input hashes are in [evaluation.json](round3/evaluation.json); [review.json](round3/review.json) checks runtime/rehearse/artifact against assigned base after LF normalization. C made no Git mutations, network/remote calls or other-agent delegation. All authored files are under this workstream; A alone commits and publishes.

## Failure diagnosis before the candidate

The existing core uses each test's **average site log SD ratio**, followed by the family's q80 statistic and two consecutive scans for spread. Strong contractions isolated to one site and a small fraction of tests are diluted by both aggregations. W25 subflow1's core spread-down gate stays below1; its last scan has only two tests exceeding the separate per-test site threshold.

| Completed devices | Core subflow1 gate / threshold | Candidate pooled q95 log drop | Candidate hits /500 |
| --- | ---: | ---: | ---: |
| 32 | 0.87128 | 0.56508 | 17 |
| 40 | 0.72435 | 0.80252 | 27 |
| 48 | 0.66900 | 0.59249 | 25 |
| 56 | 0.57802 | 0.49953 | 24 |
| 64 | 0.55081 | 0.41730 | 24 |
| 72 | 0.52632 | 1.40736 | 29 |
| 80 | 0.52075 | 1.61774 | 32 |

The candidate threshold here is log(2)=0.693147; the isolated pass at40 resets at48. Two eligible passes at72/80 produce its sole W25 alert. The evaluator independently reconstructs every W25 core family gate; all candidate family scans for all25 wafers and normal-fit scans are retained.

Absolute spread is not broadly low on W25. Initial within-site normal-relative variance, CV, per-device cross-test MAD and cross-test IQR exploration did not justify a broad low-spread rule. B independently found family median within-site SD ratios1.083–1.100, only3/500 subflow1 tests below0.7, none below normal-minimum×0.7, and all6,072,000 cells finite. See B's `workstreams/prediction/round3/diagnostics.json`; exact reviewed file hashes are in review.json.

R1's separate normal-median window candidate missed W25 and added W1@56/W23@80; its [proposal](PROPOSAL.md), implementation, calibration and failed evaluation remain intact. R2's 0.86% median wafer saving was deferred; its [profile](ROUND2.md) remains historical. This round does not revise either result.

## Implemented statistic and tuning disclosure

[pooled_candidate.py](pooled_candidate.py) is stdlib-only and consumes only `(site, current_device_values)`. It receives no wafer identity, labels, bins or future devices. Every8 completed devices it compares the first/last halves of up to20 retained observations per expected site, with at least8/site. For each test it computes population variance **within each half of each site**, averages those variances equally over all expected sites, takes square roots, then computes `log(max(early_sd,0.1*baseline_sd)) - log(max(late_sd,0.1*baseline_sd))`.

Families need at least20 eligible tests; family q95 must exceed its frozen threshold, with at least3 test exceedances, at least95% valid tests, and two consecutive fresh eligible scans. Invalid tests retain their positions and vote zero with a fixed family denominator. There is at most one supplementary emission per instance. The representative raw trace is near the gated family quantile, and all supporting test names and completed-device order are retained. Score is a threshold ratio, not probability.

Thresholds are max(normal-fit prefix statistic)×1.2 with floor log(2). Fit wafers are `[2,4,5,7,8,10,11,13,16,17,19,20,22]`, inherited from the artifact. Main's threshold is0.721597683746169; all six500-test subflows use log(2). The resulting3024 eligible tests exclude undersized families. Existing artifact SD scales are inherited, with their prior calibration provenance; labels select fit/evaluation partitions offline only.

**Selection bias remains:** q95, window size, minimum support and persistence were chosen after examining reused development data including W25. Normal-only threshold fitting does not undo that selection. The13 fit wafers also appear in evaluation; other wafers had already been inspected. None is an independent holdout. Adjacent scans share most observations and are not independent confirmation.

B independently reproduced all six supplementary alerts. Its recalibrated q90, q97.5 and q99 alternatives, or three-scan persistence, lose W25. Its W25 support is32/500 tests; median dominant-site share of early variance is99.32%, involving sites1/2/3 across tests. This is a plausible sparse temporal signal, **fragile under parameter changes**, not validated production performance. See `workstreams/prediction/round3/pooled-challenge.json`; B's independent arithmetic does not certify this streaming implementation.

## All25 accounting — original alerts preserved exactly

The composition keeps baseline and supplementary emissions separate. Candidate `emitted` never touches core `emitted`. Every original alert's **complete canonical payload**, not only its category/time, equals the retained R1 oracle. [review.json](round3/review.json) records all25 historical/current canonical hashes, exact `(kind, completed_devices, test, site)` signatures and added/removed signatures. Raw full alerts are in evaluation.json.

In the table, `up/down` mean `mean_drift_up/mean_drift_down`; `SD↑/SD↓` mean `spread_up/spread_down`. All six supplementary alerts are SD↓, separately identified by `pooled_within_site_temporal_q95_v1`.

| Wafer | Original alerts, unchanged | Supplementary | Expected-label first position in diagnostic union |
| --- | --- | --- | --- |
| 1 | site_imbalance@32 | SD↓@56 | 32 |
| 2 | low_yield@32 | — | normal label; valid yield exception |
| 3 | low_yield@32 | SD↓@40 | 32 |
| 4 | — | — | normal |
| 5 | — | — | normal |
| 6 | — | — | normal |
| 7 | — | — | normal |
| 8 | — | — | normal |
| 9 | low_yield@72 | — | 72 |
| 10 | — | — | normal |
| 11 | — | — | normal |
| 12 | — | — | normal |
| 13 | — | — | normal |
| 14 | up@32, down@56, SD↓@64 | SD↓@64 | 32 |
| 15 | — | — | normal |
| 16 | — | — | normal |
| 17 | — | — | normal |
| 18 | down@32, up@56, SD↓@64 | SD↓@64 | 32 |
| 19 | — | — | normal |
| 20 | — | — | normal |
| 21 | — | — | normal |
| 22 | — | — | normal |
| 23 | up@32, down@32, SD↑@40, SD↓@72 | SD↓@64 | 40 |
| 24 | — | — | normal |
| 25 | — | SD↓@80 | 80, research only |

Counts: **14 baseline alerts retained, six supplementary added, zero removed**,20 total evidence records. W14/W18 have same-scan overlapping categories; W23's earlier supplement does not replace original SD↓@72. W1/W3 are two additional unadjudicated categories; W25 is the intended label match. Do not call all six additions correct.

There are no added alerts on18 normal-labeled wafers. Existing W2 low yield remains: final yield53.75%, so the normal-label false-positive proxy remains1/18, with an explained valid yield exception. Normal labels and sparse anomaly labels are not complete per-test truth. No calibrated false-positive rate, precision, accuracy or onset delay is established.

## Synthetic controls — scientific gate failed

[synthetic_round3.py](synthetic_round3.py) uses20 fixed `random.Random` seeds per mode,100 independent Gaussian tests, four interleaved sites and80 devices. Unit baseline SD and log(2) thresholds are fixed independently of the CSV data. All240 raw outcomes are retained.

| Control | Runs | Emissions | Expected result |
| --- | ---: | ---: | --- |
| Stable, increased spread, fixed site offsets, constants | 20 each | 0 each | pass |
| Missing, nonfinite and finite-overflow input | 20 each | 0 each | pass; abstention |
| One or two isolated decreasing tests | 20 each | 0 each | pass; insufficient family support |
| Broad decrease; localized10/100 tests at one site | 20 each | 20 each | pass |
| **Mean step, unchanged variance** | **20** | **20** | **FAIL: all false positives** |

The adversarial control has Gaussian variance1 throughout and adds100 to the mean after six observations/site. A step inside the earlier half inflates its SD; when the later half has settled, this looks like contraction even though the noise variance never decreased. Removing each half's mean does not remove a step inside that half. The candidate cannot reliably distinguish these mechanisms. **220/240 expectations met;20/240 failed. No promotion, no accepted replay7/7 claim.**

The36 passing unit tests include16 new structural/causal tests: missing/stale/unknown sites, numeric invalidity, preserved sample positions, isolated tests, prefix/future invariance, site renaming and within-touchdown ordering, repeated/off-cadence finalization, long-stream truncation, reset, immutable calibration and output-path restrictions. A characterization test intentionally reproduces the mean-step false positive; its pass does **not** convert the scientific gate to success.

## Wall time and retained state

Evaluation ran September19,2026,10:31:54–10:33:13 UTC on local Windows/Python3.12.2. Parsing, fitting, hashes, diagnostics and state traversal are outside the per-operation samples. There is one measured traversal/wafer, alternating execution order by filename ordinal; raw samples remain in evaluation.json. No speedup, Edge deadline or SDK callback guarantee is claimed. Constructor samples include replacing prior instances and possible reclamation costs.

| Measured wall operation | n | p50 ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: |
| Core active scan, device≥32 | 175 | 90.950 | 140.567 | 317.452 |
| Supplementary active scan | 175 | 91.837 | 135.701 | 191.396 |
| Sum of same-device core + supplement scans | 175 | 183.261 | 262.687 | 464.700 |
| Supplementary add/current device | 2000 | 0.995 | 1.770 | 3.248 |
| Supplementary construction/replacement | 25 | 58.198 | 109.362 | 114.945 |

Combined scan figures sum the two sequential measured spans; dispatcher/formatting/I/O overhead is excluded. The supplement adds substantial synchronous work and needs separate load qualification before any future use.

At80 devices the candidate retains241,920 measurement slots (3024 tests×4 sites×20) and80 order slots. Reachable mutable Python state is15,656,494–15,656,522 bytes per wafer; core state is12,274,529–12,274,769 bytes. These independent graph estimates include reachable float/key objects, exclude frozen calibration, scan temporaries, external alerts and process RSS, and may double-count shared objects if naively added. They are not peak memory.

Measurement history stays capped at20/site; an800-device synthetic stream verifies truncation. Configuration caps at4096 tests and8 sites (655,360 measurement slots). Python device/site counters still grow logarithmically in stream length; no strict constant-byte claim. Core remains unbounded; adding this sidecar does not bound the existing detector.

## Minimal A integration recipe — retained for review, not approved

1. **Current action: retain research only.** Do not wire this into runtime or amend accepted replay coverage. If a later independently validated revision is approved, copy the frozen [evaluation.calibration.json](round3/evaluation.calibration.json) to a separate `grp6_app/artifacts/pooled_spread.json`. Keep `runtime.json` unchanged; prediction model SHA remains `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`. Register a separate detector/calibration SHA and preserve both provenance identities.
2. Create a separate instance per trusted run/tester/lot/wafer scope only after the **full current active-site layout** is known and matches calibration sites1/2/3/4. This offline fit infers sites from a completed input CSV; that is not live topology discovery. Do not infer a reduced site set from whichever sites have arrived. Unknown scope/layout or a changed site population must abstain/reset pending trusted configuration. At least8 observations and new observations since the prior scan are required from every expected site.
3. Feed the same completed-device values to the sidecar after core ingestion, preserving core code/alert payloads/emission state. Publish any future approved candidate result as separately identified supplementary evidence, even when category/time overlaps. Never use candidate `emitted` to suppress baseline emissions. Live head/attempt identity, retest ordering and lifecycle routing remain A's runtime responsibilities.
4. Finalization cannot manufacture a second vote: the implementation ignores repeated and off-cadence `final=True` scans. W25 emits only on the ordinary device80 scan. **Without verified post-final message retrieval, abstain from promising a live actionable W25 alert**; a strict pre-final delivery policy would miss it. Preserve pending evidence and distinguish emitted/queued/returned/received/displayed. There is no Edge activation, timeout, units or tester-receipt acceptance here.

## Reproduction, exact hashes and historical evidence

From the repository root, run:

```powershell
python -B -m unittest discover -s workstreams/detection -p test_*.py -v
python -B -m workstreams.detection.evaluate_round3 --output workstreams/detection/round3/reproduction.json
python -B -m workstreams.detection.audit_round3
python -B -m workstreams.detection.verify --contribution-ref 5f403bd
python -B -m workstreams.detection.package_round3 --verify
git diff --check
```

The evaluator defaults to the25 `source_review/training/Data/*_RawResult.csv` files, `grp6_app/artifacts/runtime.json`, and the retained baseline oracle. It refuses an existing output and rejects paths outside this workstream's round3 directory. A fresh stem writes both report and `.calibration.json`; timings/timestamps will differ. Optional absolute-variance reproduction: `python -B -m workstreams.detection.diagnose_round3` (fresh `round3/absolute-variance.json`, no historical overwrite).

Recorded results:36 unit tests pass ([tests.log](round3/tests.log)); all-wafer evaluation exits0 while explicitly recording20 failed research expectations ([evaluation-run.log](round3/evaluation-run.log)); exact evidence audit passes with an explicit RESEARCH GATE FAIL ([evidence-audit.log](round3/evidence-audit.log)); R1 historical hash audit passes ([historical-audit.log](round3/historical-audit.log)). Evaluation completion is not scientific acceptance. `git diff --check` passes; package verification checks every inventoried hash.

Frozen calibration content SHA256, computed over sorted compact JSON excluding its own hash field: `d9941c35f9d518c1567b822935d1079517829323092190c4ce2b2319425cc4b0`. Raw file SHA differs and is recorded in review.json and [manifest.json](round3/manifest.json). Evaluation records exact25 CSV, runtime/artifact, evaluator/candidate/control/helper and historical-oracle byte hashes, checked unchanged after the run. Final manifest identifies all implementation/document/evidence files; C has no publication commit.

[INVENTORY.md](round3/INVENTORY.md) enumerates every retained workstream file and textual references. Eight `round3/exploration*.json` snapshots preserve exploratory variants and tuning history; most were generated with one-off inline NumPy commands and are not a fully scripted final experiment. `exploration-lowest.json` contains a NaN from a constant-test exploratory division warning; it is explicitly invalid strict-JSON exploratory evidence, not part of acceptance. No such NaN exists in final evaluation. Failed exploratory observations are retained, not relabeled as validated results.

Final owner action: A reviews this rejected research package and publishes it under A's commit. No candidate/core/model/deployment promotion is requested.

A's final independent audit matched all1225 candidate scan scores/thresholds to B's oracle and all14 baseline alerts to exact replay, reproduced20/20 Gaussian mean-step failures plus B's step@96 and impulse@40 cases, and recorded REJECT in `results/r3_research_review.json`. This corroborates the negative recommendation; it does not resolve the failed specificity gate.
