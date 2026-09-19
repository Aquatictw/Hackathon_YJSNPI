# Supplied-program evaluation and end-to-end dataflow audit

Observation date: September 19 UTC / September 20, 2026 Asia/Taipei. Source HEAD before dropdown changes: `69658a7e8be941bdadb062229bd567a09013a6aa`. VPS release remains `14ff55bfd31694e49ff324564b13c0535d16fe9a`.

## Result

The tester/Edge prediction path works for the supplied offline replay test program. The website is **not connected end to end to those fresh runs**. Live export configuration is absent, the hosted database remains replay-only, and the tester Message Center rejects the combined anomaly message. A connected website event stream proves only browser/backend connectivity.

The run selector is now implemented locally, with real database discovery and explicit Load. It has not been deployed. No model was retrained, detector promoted, production database changed, or competition-VM file transferred in this investigation. Nexus was not restarted.

## Fresh machine evaluation

Verified machine `group-6`, grp6 host/Edge dashboard rows. Ran the existing supplied `acs_tcct_4site_ft.xml` recipe through TCCT `-m`, preserving the workspace and descriptor instead of recreating the session. The recipe uses `TestCase1_4site_ft.prog`, offline replay enabled, four sites and 20 touchdowns. Two runs each completed 80 devices, 74 pass / 6 fail (92.5%). They replay the same deterministic dataset and are not 160 independent test samples. The second run had collection active before execution.

| Complete fresh run | Observed result |
|---|---|
| Scope | run `b7deb9e5ff1641c6a16546eda090c121`, tester `group-6`, lot `B13456`, wafer `02` |
| Evidence | 764 events, continuous sequence 1–764, no error events |
| Predictions | 120 requests; 480/480 strict prediction/actual joins, 80 values per stage |
| Tester execution | 120/120 response payloads matched distinct EDL Actions lines; all 120 have adjacent `Exec Pass: 1 Exec Fail: 0` |
| Production responses | 20/20 embedded response strings pass strict JSON parsing |
| Anomalies | Three alerts at completed device 32: site imbalance, mean up, mean down |
| Callback | Maximum 18.968843 ms; not an end-to-end response-time guarantee |

Prediction MAE is absolute predicted-minus-measured error in supplied numeric units. Physical units and acceptable error tolerance remain unverified.

| Stage | Wafer-separated training CV MAE | Fresh supplied-program MAE |
|---|---:|---:|
| 1 | 0.003488 | 0.378586 |
| 2 | 0.026927 | 0.094628 |
| 3 | 0.020418 | 0.098214 |
| 4 | 0.024779 | 0.064507 |
| 5 | 0.063132 | 0.515294 |
| 6 | 0.027588 | 0.146822 |

Overall fresh MAE: **0.21634160538139474** across 480 values. The results reproduce the older supplied-program capture; repeating it does not create a new independent holdout. Error increases materially relative to training CV, especially stages 1 and 5. Do not call these models accurate enough without a tolerance and independent evaluation.

## Training/test provenance and wafer discrepancy

PDF pages 3/7 designate W1–W25 (25 × 80 devices) as training data and supply a tester program for evaluation. The six Ridge models use five folds separated by wafer modulo five: 20 wafers train and five validate per fold. Feature selection, imputation and scaling fit training folds only. Final models fit all 25 wafers; a replay of these fitted wafers is not independent validation. Future sensor targets, final bins/pass-fail and evaluation labels are excluded as prediction inputs.

The anomaly detector is a separate baseline/rule system. Its calibration and subsequent tuning inspected these same 25 wafers, including nominal holdouts. Its replay category coverage is development evidence, not a clean independent test.

The configured remote ORE input is `/home/user/Case_Event/SmarTest/Case_Smt870/src/TestCase1/TestCase1_OfflineData.csv`: 80 DUT columns, 3,036 measurement rows, lot B13456 / wafer 02. Comparison against the 2,000 training devices found **zero exact six-target-vector matches** and a different file hash. This rules out exact target-vector duplication, but does not establish the simulator's statistical independence or generation lineage. It was not used to retrain models in this investigation. No independently supplied anomaly labels/onsets were found for it, so anomaly precision/recall cannot be scored.

The PDF labels W2 Normal and W25 Stdev Trend Down. W2's training file has 43/80 passing devices (53.75%); PF and bin fields agree. Thus its low-yield alert is arithmetically supported, but is a **false positive relative to the PDF label**. The supplied evidence cannot establish whether that label or dataset intent is wrong. W25 is missed in the accepted/deployed replay. Commit `a869f185e37a6b1547cedf0fb0c6cab896818c24` adds a source-only candidate detecting it at device 72; that does not regenerate the static frontend summary or certify independent performance. See [original investigation](../replay_investigation_20260919/REPORT.md).

## Dataflow boundary results

| Boundary | Status and evidence |
|---|---|
| Supplied tester → Nexus/ONEAPI → model | Verified on fresh ORE run, full prediction joins |
| Prediction action → tester execution | Verified 120 matching actions and successful adjacent executions |
| Anomaly action → TCCT receiver | All three IDs appear in On_POSTBIN response logs |
| TCCT → Message Center anomaly display | **Failed:** combined anomaly text reaches ProdMessage, followed by `Warn: does not support`; no corresponding Insert text. Nearby prediction messages do have Insert text. |
| Edge → HTTPS backend | **Disabled in inspected configuration:** both descriptor envs omit GRP6_EXPORT_URL/token; pinned host image Config.Env also has no export URL. Optional exporter is disabled without it. |
| Backend → frontend | Replay snapshot and SSE work, but do not establish tester connectivity |
| Replay Analysis | Static `/replay/summary.json`; does not become live through ingest |

Anomaly short IDs: `44f001f09873`, `badb1939dc8b`, `884172dbb757`. Fresh get_prod JSON is valid; downstream ProdMessage output contains literal multiline text before rejection. Downstream reserialization is a plausible cause, not yet source-proven. Preserve this failure rather than treating the API normalization as complete delivery acceptance. Final-boundary anomaly delivery is also unverified.

The isolated pinned host image contains exporter.py but lacks later ACK/quarantine hardening. Actual running Edge image tag/digest was not certified. A safe next transport release must include the intended exporter, endpoint/token and durable outbox configuration, then verify original event identity through actual-container HTTPS, committed DB, snapshot and SSE. Enabling an old exporter alone is insufficient reliable-delivery acceptance.

The hosted database was checked before and after both fresh runs: exactly one run, `grp6-replay-demo` / `grp6-replay`, edge `grp6-replay-exporter`, mode replay, last source event `2026-09-19T02:47:32.000Z`, **114 events**. Fresh machine-generated UUID runs were absent. Therefore the single frontend choice reflects a single stored replay run, not a single possible tester run.

Optional website-to-tester commands are not connected: no Edge command poller/executor found, and VPS COMMAND_TOKEN is absent. This is separate from read-only live display. [Detailed source audit](frontend/REPORT.md) is a pre-dropdown snapshot and should be read with the newer implementation below.

## Dropdown implementation and verification

`GET /api/v1/runs` reads actual stored tester/run pairs, ordered by receipt/update freshness with stable pair tie-breakers. UI uses a paired dropdown to prevent mismatched IDs, labels replay/simulation/source-reported live, includes refresh/pagination/timestamps/manual fallback, and changes active source only on Load. Discovery does not overwrite saved imports. English and Traditional Chinese are supported. Offset pages can shift during concurrent ingestion; Refresh reloads newest results.

Delegate checks: **178 frontend tests**, TypeScript, production build, focused lint and whitespace checks passed. Parent reviewed the patch and verified actual browser behavior against an isolated local D1 database (`frontend/.wrangler/run-picker-audit`): unavailable/empty states, two distinct tester entries sharing one run ID, correct mode labels, explicit loading of tester B, SSE, selecting tester A and refreshing without switching the active tester B, and Traditional Chinese labels. Test fixtures are expressly synthetic and never entered hosted storage. No paid model calls.

## Retained evidence and limits

Raw fresh evidence remains on the competition VM at `/home/user/Case_Event/dataflow_evaluation_20260920_Ns5HDP`; local observation fields were transcribed from browser SSH output. No raw VM download is implied. The directory retains original config backup, capture logs, `fresh_complete.jsonl`, strict audit, prediction receipt matches, dataset identity check, ORE input/recipe copies and receiver logs. Earlier `observed.jsonl` had an extraction newline issue; use `fresh_complete.jsonl`.

| Artifact | SHA256 |
|---|---|
| Frozen runtime model | `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9` |
| Fresh complete JSONL | `3771ad091d104be7bc5d33244611ab71dc824ecf7819961f0489f2e952d1b1b1` |
| Supplied ORE CSV | `71a05058c863191883f2b69c81aea1a980bc72239bdc0f1e9dea9d435edd9196` |
| Fresh EDL | `733cd0f07456058c9ef700da05d05e08c06539cdc123a793a3d14ac23a9c9e6b` |

EDL source: `/tmp/STDF/datalog_TestCase1.TestCase1_4site_ft_lot1_4site_finaltest_group-6_20260920004549.edl` (42,738,914 bytes). Prediction receipt audit completed at remote UTC `2026-09-19 16:54:21`. Machine was left bound/idle, SMT8 ready with Edge available; bounded collectors ended. No runtime changes/deployment were made. Historical local evaluation remains under [test_program](test_program/REPORT.md); its missing-local-ORE statement is superseded only by the remote observations above.
