# Eight-input fallback: offline proposal for A

Keep the production primary. The sparse model is **not recommended as a general replacement**: complete-data MAE regresses in five of six stages. A primary-first fallback preserves available primary predictions and improves availability under simulated independent input loss, at the cost of less accurate additional predictions. Promotion requires an agreed error tolerance and machine validation.

Branch: `team/b-prediction`. Base: `eababfc4ffbb6c6faea4136b3dd9724773247aab`. Evaluation date: September 19, 2026. All authored files are under `workstreams/prediction/`; production code/artifacts are unchanged.

## Reproduce

From the repository root, using existing Python 3.12.2 / NumPy 2.2.6 (no dependency changes):

```powershell
python -B -m unittest discover -s workstreams/prediction -p test_prediction.py -v
python -B -m workstreams.prediction.evaluate --data source_review/training/Data --flows source_review/SmarTest/Case_Smt870/src/TestCase1 --runtime grp6_app/artifacts/runtime.json --manifest grp6_app/artifacts/manifest.json --reference grp6_app/artifacts/validation.json --reference results/model_revalidation/validation.json --output workstreams/prediction/results
python -B -m workstreams.prediction.audit --results workstreams/prediction/results --report workstreams/prediction/results/audit.json
```

These exact commands passed (exit 0). Logs: `unit-tests.log`, `evaluation.log`, `audit.log` in this directory. To preserve recorded results, substitute `workstreams/prediction/reproduced` in both evaluator/audit paths. The evaluator refuses output outside this workstream. Runtime is several minutes locally; latency measurements vary and are not byte-reproducible. Evaluation-time source revision is the base plus uncommitted workstream code, identified by exact code hashes in provenance; the containing Git commit records the final deliverable.

## Method and complete-data results

25 CSVs / 2,000 devices / four sites. Five folds use wafer number modulo five, matching the unchanged builder. Within each training fold, reuse baseline median imputation, scaling, correlation selection and Ridge fitting. The candidate fixes eight selected features and alpha=10 before evaluation; no parameter search was performed. Runtime inference requires every selected input finite and never substitutes training medians for absent streaming data. Training with no usable data fails explicitly.

Nested TP flow parsing exactly matches the frozen manifest. Eligible feature counts are 25, 525, 1,025, 1,525, 2,025 and 2,525. All sensor targets, future flows, final bins, PF, total test time and labels are excluded from model inputs. Primary/candidate have 25–32/eight selected inputs. `candidate.json` is an all-data fitted proposal; **only fold models produce the reported held-out errors**.

All six primary aggregate metrics reproduce both recorded validations with absolute difference **0**. Every recorded wafer/site metric matches within 1e-8 relative / 1e-10 absolute tolerance. Full-data primary refits match frozen model selection and numeric parameters within that tolerance. Errors below are unverified CSV units. Each row covers 2,000 held-out targets; prediction and selected-input coverage are 100% for both models.

| Stage | Primary MAE | Sparse MAE | Primary RMSE | Sparse RMSE | Primary worst | Sparse worst | Wafers with MAE regression |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.003488 | 0.009279 | 0.005727 | 0.014427 | 0.078549 | 0.070825 | 23/25 |
| 2 | 0.026927 | 0.040855 | 0.035721 | 0.053764 | 0.173415 | 0.221524 | 25/25 |
| 3 | 0.020418 | 0.020282 | 0.034731 | 0.034125 | 0.366223 | 0.366925 | 13/25 |
| 4 | 0.024779 | 0.056881 | 0.033655 | 0.072423 | 0.155997 | 0.291132 | 24/25 |
| 5 | 0.063132 | 0.067750 | 0.079303 | 0.085420 | 0.261968 | 0.290823 | 22/25 |
| 6 | 0.027588 | 0.029473 | 0.034774 | 0.036780 | 0.118694 | 0.126212 | 21/25 |

Stage 3's small aggregate MAE improvement is not universal: 55/100 wafer-site groups regress and worst error increases. Complete-data primary-first fallback has exactly the primary's errors.

## Missing-input results and cost

One deterministic stress mask drops 10% of features independently (seed `20260919 + stage`), shared between models and independent of targets/selection. This is a synthetic scenario, **not measured machine missingness**. Both policies abstain when their selected inputs are incomplete. Coverage means emitted predictions / finite target rows; it is separate from selected-input coverage.

| Stage | Primary availability | Fallback availability | Added predictions | Added-row MAE | Added-row worst |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 7.45% | 40.45% | 660 | 0.009210 | 0.069293 |
| 2 | 3.00% | 42.50% | 790 | 0.040814 | 0.221524 |
| 3 | 3.55% | 43.40% | 797 | 0.019492 | 0.282245 |
| 4 | 3.40% | 43.00% | 792 | 0.055335 | 0.232521 |
| 5 | 3.10% | 41.10% | 760 | 0.067282 | 0.290823 |
| 6 | 3.40% | 44.30% | 818 | 0.029385 | 0.119121 |

There are zero lost primary predictions and zero common-row error changes for fallback in every scenario. Error averages over different emitted subsets are not a paired accuracy comparison; machine metrics retain common-row deltas and added-row errors separately.

Removing the latest eligible nested flow (IDDQ at stage 1; subflow N-1 thereafter) leaves the primary unavailable at all stages. Sparse fallback recovers stage 3 at 100% (MAE 0.020282, worst 0.366925) and stage 4 at 60% (MAE 0.065003, worst 0.253200), but **recovers nothing at stages 1, 2, 5 or 6**. Stage 4 coverage is fold-dependent; an all-data model need not recover the same percentage. Empty input emits no predictions in all stages; errors are null, never fabricated zeros.

Local scalar timing uses full-fit models, 64 evenly spaced snapshots, warmup and five repetitions (320 calls per policy/scenario/stage). Complete-input p95: primary 7.805–17.910 microseconds, sparse alone 3.500–4.000, primary-first fallback 8.205–13.900. Random-loss fallback p95 is 8.500–13.205 microseconds; maximum observed across all fallback scenarios is 88.1 microseconds. Primary/fallback timing noise does not establish a speedup. The fallback adds a second model and inference only on primary abstention, plus result metadata; sparse-only speed is not primary-first speed. This excludes data copying, readiness waits, detector work, SDK/ActionManager and callback latency, and establishes no TP deadline compliance.

## Evidence and limits

- `results/metrics.json`: all stage, site, wafer and wafer-site errors, coverage, paired comparisons and latency for complete/random-loss/latest-flow-missing/empty scenarios. `summary.csv` provides stage summaries; `fold_models.json` retains all 30 primary/candidate fold pairs.
- `results/predictions.csv.gz`: 48,000 unique scoped stage/scenario rows with held-out targets, primary/sparse/fallback values, source and coverage. `audit.json` independently recomputes **9,360 metric groups** and verifies input/output hashes, disjoint folds, causal features, strict availability and primary preservation.
- `results/checks.json`: all six stages pass future-feature poisoning, scalar/matrix parity, frozen-primary refit and empty abstention. Thirteen unit tests cover invalid/missing/overflow inputs, unknown stages, immutable per-scope snapshots, ordering independence, training statistics, insufficient data and output boundaries.
- `results/provenance.json`: exact input/data/model/code/output hashes, seed, paths, branch, base and environment. Data aggregate SHA256: `883fdc110dc665f274ab7ea62e1342ed03059d421239a86f6533a094463ba60d`; frozen runtime: `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`; candidate: `ead29fd38a098bcbd5f5815b044914d9057b2e9c5a276b36c039df5de96352a5`. Aggregate data hash covers sorted filename→raw-file-hash JSON as implemented in the evaluator.

These wafers were already inspected during earlier development; wafer-separated validation does not create an untouched holdout. The fixed candidate was not tuned after seeing these results. MCAR and whole-flow loss do not model all real missingness or distribution shifts. Device/site isolation tests prove this stateless proposal does not combine supplied snapshots; CSV identity is lot/wafer/PID/site and cannot prove real SDK run/tester/head/attempt lifecycle isolation. Units, scaling, flags, late arrival, timeout behavior, accuracy tolerance and on-machine performance remain unverified. No deployment or runtime replacement occurred.

## Proposed integration — A only

No external edit is required to reproduce this proposal. If A elects to trial it, A owns `grp6_app/runtime.py` and `grp6_app/artifacts/`: review a separate optional sparse artifact without replacing primary coefficients. A also owns `grp6_app/monitor.py`: preserve the existing bounded feature wait and lifecycle rejection, and consider fallback only after primary remains unavailable. Record model source, primary coverage and used-model coverage separately; a complete sparse input set must not imply primary readiness or perfect accuracy. `candidate.py` returns proposal dictionaries, **not a new TP reply shape**. Shared evidence/API changes would require A's coordination.

Next decision for A: retain the baseline, and decide whether a bounded fallback trial is justified after defining acceptable added-row error; stage 4's regression and unrecovered flow losses are explicit reasons to defer broad enablement.
