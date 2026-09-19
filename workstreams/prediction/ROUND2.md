# B: recorded readiness audit — R2-20260919

Recorded selected-input readiness and prediction receipts are consistent: engineering has 6 requests / 24 site predictions / 24 unique actual joins / 6 successful action matches; production-3 has 120 / 480 / 480 / 120. **This does not close G1/G2.** Production sequence 319 still contains malformed action JSON, and anomaly execution/display remains unverified. No runtime, model, deployment or historical evidence was changed.

Base: `a0d43172bbbdbde75fa1185d8037d4a35b787d4c`; local branch: `teammate-b-prediction`. The R1 evaluation and its unsuccessful sparse-model results remain intact. This document reports B's offline findings and proposals; SYSTEM.md remains the project authority.

## Reproduce and inspect

Run from the repository root:

```powershell
python -B -m unittest discover -s workstreams/prediction -p 'test_*.py' -v
python -B -m workstreams.prediction.readiness_audit --output workstreams/prediction/round2/readiness.json
python -B -m workstreams.prediction.audit --results workstreams/prediction/results --report workstreams/prediction/round2/prior-audit.json
git diff --check
```

The readiness CLI uses the **exact Git blobs at the R2 base**, requiring that commit in local history. Its nine default input paths are recorded in `readiness.json.inputs` and `readiness_audit.py:INPUTS`: engineering JSONL and EDL, production-3 JSONL and tester text, engineering audit, production strict audit, production receipt audit, receiver observation and runtime artifact. It does not contact the machine or network. The default output is `workstreams/prediction/round2/readiness.json`; resolved paths outside this workstream, including traversal or symlink escape, are rejected before reading inputs.

Windows checkout converted historical text files to CRLF: their checkout byte hashes differ from the recorded captures. The audit does **not** weaken evidence hash equality or rewrite those files. It hashes and audits the immutable base blobs, whose hashes match the historical audits, and separately records checkout hashes and equality. Reproducing on a different checkout can change that diagnostic metadata.

`round2/validation.json` gives exact auditor/test/output/log SHA256 values at validation, with the commands and exit codes. `round2/tests.log` records 36 passing tests (13 preserved R1 plus 23 R2). `round2/readiness.log` records all 13 consistency checks passing. `round2/prior-audit.json` recomputes 48,000 prediction rows and 9,360 metric groups, verifying previous folds, hashes and primary preservation. Its passing check was reused after changes confined to the new R2 auditor/tests.

## Readiness, actuals and timing

Predictions in each capture have one observed run/tester/lot/wafer and four sites, 1–4; startup records have a separate process run identity. Engineering has one request per stage; production has 20 per stage. Every stage/site has 1 engineering or 20 production rows, recorded coverage 1, an explicitly empty missing-feature list and a unique finite actual. These are selected-model-input claims logged by the runtime, not independent reconstruction of every feature. All prediction units are null and head/attempt fields are absent. Unknown values are represented as null or counted explicitly.

| Stage | Engineering callback ms | Production callback min / p95 / max ms | Production waited requests | Requests per production site / joined actuals |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0.418575 | 0.364025 / 7.398579 / 8.349962 | 18/20 | 20 / 20 |
| 2 | 0.588548 | 0.405285 / 1.301048 / 1.330537 | 0/20 | 20 / 20 |
| 3 | 1.740743 | 0.385846 / 0.819561 / 2.522604 | 0/20 | 20 / 20 |
| 4 | 0.849101 | 0.401115 / 1.110625 / 1.320128 | 0/20 | 20 / 20 |
| 5 | 0.619779 | 0.437926 / 1.007913 / 1.081684 | 0/20 | 20 / 20 |
| 6 | 0.582028 | 0.452066 / 0.928892 / 1.039174 | 0/20 | 20 / 20 |

The JSON contains all 24 stage/site groups per capture, scoped request counts, flags, missing-input names/counts, feature-count statistics and callback timing. A callback serves four sites: its timing is shared across site groups, not four independent timings. Aggregate statistics count each callback once. p95 uses nearest rank.

Production callback p95 across 120 requests is 3.309545 ms; maximum is 8.349962 ms. The 18 waited requests range from 1.821044 to 8.349962 ms. All 126 recorded lifecycle-changed flags are explicitly false; engineering has zero waited flags. There are no separate wait durations, initial missing-input sets, deadline-expired flags or stress cases. The production flags establish observed bounded-wait-path use followed by available predictions, not controlled late-data recovery or timeout acceptance.

Only 12 measurement samples exist in each capture. Observed feature counts vary (for example production stage 2 is 523–526), and may include values outside the selected feature list. Neither counts nor sampled measurements establish causal membership or full measurement completeness. Actuals are logged at device test-end, so their timestamps do not establish the sensor acquisition instant. Unique joins establish correlation, not accuracy tolerance or future-feature exclusion.

The auditor recomputes scoped joins using run, tester, source mode, lot, wafer, test UUID, touchdown, stage, request, site, device and prediction identity. Supplied head/attempt must agree on both sides; when both are absent their absence remains explicit. Exact event retries deduplicate; conflicting same-ID content is excluded. Reused request/prediction identity, distinct equal-valued actuals, lifecycle flags or intervening boundaries block joins. Missing expected sites remain in the denominator using a uniquely scoped preceding test-start event; without such metadata readiness is unknown.

The recordings contain no conflicting event IDs or missing sequence ranges; engineering sequence is 1–52 and production is 1–765. The process-wide monitor-start has no tester-scoped identity and is retained as unknown; it is not fabricated into a tester event. Sequence continuity does not prove events omitted before logging or full SDK data delivery.

## Receipt and historical-failure boundaries

The auditor independently parses `Actions =>` JSON in production tester text and engineering EDL, requires a unique equal parsed response and adjacent successful `default` execution, and consumes no receipt twice. Engineering uses embedded text in binary EDL, not a complete EDL decoder. Matches record byte offsets; production line numbers match all 120 entries in the saved receipt audit. Tester payloads carry tester and action content but no Edge run ID, so association to the saved capture supplies run provenance. Repeated equal response payloads would be ambiguous and fail correlation.

Tester-reported Nexus process-action time is 5–41 ms engineering and 4–106 ms production; adjacent adaptive execution is 10–11 ms. These spans differ from Edge callback measurements and cannot be substituted for them. `timeout=1` and `set_wait(...,10,...)` remain uninterpreted for effective prediction deadline compliance.

Strict parsing checks all 20 production action responses and independently reproduces the single failure at sequence **319**, event `d6e6c94ce57641be8ac49ac73bc1a645`, column **256**. The top-level audit PASS means the evidence interpretation and historical audits agree; it is not a callback/live-acceptance pass. The input is the historical pre-fix run and does not test the later deployed fix.

The receiver observation lists anomaly IDs `bbe24a7975e6`, `7d9bfbbb7dd9`, `60d64c90b080` at TCCT On_POSTBIN. Its original remote logs were not rechecked; their two recorded clocks remain unaligned. Parsing, execution/display and final-boundary delivery remain unverified. Prediction receipts do not promote anomaly receipts to confirmed.

## Exact input identities

These are raw SHA256 hashes of the audited base blobs. Full repository paths and separate checkout hashes are in `round2/readiness.json`.

| Input | SHA256 |
| --- | --- |
| Engineering JSONL | `274c1892e177dc6834bfd6931b8924c560e53fb9a5f367766434591fbedb4da3` |
| Production-3 JSONL | `dcd2fda6e8b09dd9fb51f9c713098c756abd1d24caece813a709af6bcd8fa4af` |
| Engineering tester EDL | `d06e6f85d120a29492a8e49f6b54a43a3e1e2fa5251153a63ca93e7c36812d85` |
| Production tester text | `ca3068a29c420401299751a8c13e5930f31c5912f0ab0389c9dea0cf62b6fed2` |
| Engineering saved audit | `55951d20a0d14ab85f41bf8e517b96d6046971cedc57cdfdabeb49091045b540` |
| Production strict audit | `76c54f9e06487cc4724d08d6fcfdc1f5c425a74c5984122999baed9eb121f038` |
| Production receipt audit | `f0bdf52bf1729a1ddb3b9914fa4a9aca6c4e74b26311ed5ff6428aaf9b8ccfbc` |
| Receiver observation | `5e876d8792aba092b4e52f47e6a1903c6707364ad2fcb2885020781a20b5a798` |
| Runtime artifact | `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9` |

## G1/G2 machine-test matrix proposed to A

All rows remain open. A owns execution, SDK/TP verification and any runtime instrumentation; B has performed no machine action. Use a pinned image/model, preserve the existing session/logs, correlate Edge request/per-site IDs with tester receipts, and record configured and observed timing units. Do not rerun a production lot merely to duplicate the existing normal-path evidence. Controlled engineering cases can fill the missing evidence.

| Case / gate | Controlled input or trigger | Required evidence and decision |
| --- | --- | --- |
| M1 / G1 units, scaling, flags | At each stage/site capture selected-input and sensor native raw values, unit/scaling and valid/invalid flags; compare scaled/unscaled known examples with supplied SDK/TP definitions. | Preserve native getter values, mapping and tester measurement. Resolve units/scaling/invalid bits before claiming temperature units or tolerance; invalid/nonfinite inputs must not silently become available. |
| M2 / G1 causal eligibility | For six stages × four sites, capture exact selected-feature identity and ingress order at request time; include one distinguishable future-flow/sensor value in controlled replay or approved fixture injection. | No target, future-flow, bin or previous-device feature can affect prediction. Full selected-input snapshots and TP flow positions are required; the existing 12 samples cannot pass this case. |
| M3 / G2 within-budget arrival | Delay one required feature on one site until 50 ms, 150 ms and near the configured feature-wait boundary, with other sites complete; start each case from a fresh device scope. | Prove lock release allows delivery, all emitted sites use the same current scope, and record initial missing set, arrival/wake time, total callback span and correlated tester action. Repeat per stage; do not infer recovery just from waited=true. |
| M4 / G2 expiry and missing data | Hold one required feature beyond the configured ≤200 ms cap, then deliver it late; also test one wholly missing site and all sites absent. | Record cap and effective TP deadline separately. Verify no invented prediction/zero or stale reuse, exact actual returned string and tester handling. Late data must not satisfy a subsequent wrong-device request. Current callbacks do not establish this behavior on machine. |
| M5 / G2 request/action errors | Send an unknown stage, malformed request and unsupported key through the verified test harness; arrange a controlled ActionManager setter rejection if the SDK permits it. | Capture request_error/action_error, exact callback return, pending action state and tester timeout/error. Establish the TP-supported failure behavior from observation; do not design a new error shape. |
| M6 / G2 lifecycle change while waiting | During M3's wait, separately advance touchdown, wafer, lot, tester disconnect/reconnect and run; release the old feature afterward. | Old request must abstain/reject; no pending prediction or old actual joins the new scope. Preserve before/after identities, lifecycle flag, request and receipt. Runtime/source tests alone do not close this case. |
| M7 / G2 head/retest collisions | Reuse PartID/site on a second verified head and on a retest attempt; interleave input/actual arrival across the two scopes. | Verify native head/attempt semantics first, then record distinct device/test identities. Ambiguous multi-head/attempt data must fail closed. Both fields are unknown in the existing captures. |
| M8 / G2 end-to-end deadline under load | Establish prediction timeout units from TP/native behavior; test requests close to that deadline with detector/report work active, plus an approved backend outage. | Record monotonic callback, request/receive and tester execution spans, lateness and response/error receipts. The 8.35 ms callback maximum and 106 ms tester span measure different boundaries; neither sets an accepted deadline. |

Related G4 dependency: after A verifies actual Edge image identity, correlate the normalized anomaly through set_message → get_prod → tester parse/execution/display, including an alert at the final boundary with no later normal poll. Preserve the historical sequence-319 failure rather than replacing its evidence.

Outside-scope requests: **A**, review whether `grp6_app/monitor.py` and machine capture tooling need initial missing-feature sets, wait duration/expiry and verified head/attempt provenance to execute M1–M8; coordinate any new evidence/API fields with D/E. **A**, verify supplied TP/SDK deadline semantics and native getter fields in `source_review/` and the deployed container. **A**, promote reviewed audit conclusions into SYSTEM.md. These are follow-up proposals, not changes required to run B's offline audit. No public authentication, live transport, deployment, units or accuracy gate is closed here.

## Complete workstream inventory and references

Inventory checked with `rg --files workstreams/prediction` and repository/workstream reference searches. Every pre-existing file is retained byte-for-byte; no cleanup is authorized. New R2 artifacts are referenced below. Relative paths in this table are under `workstreams/prediction/`.

| File(s) | References / retained purpose |
| --- | --- |
| `EVALUATION.md` | SYSTEM.md and this report; preserved R1 method, negative results and reproduction commands. |
| `candidate.py` | Imported by evaluate.py/test_prediction.py; evaluator hash in results/provenance.json. |
| `evaluate.py` | EVALUATION.md CLI, test_prediction.py imports, results/provenance.json evaluator hash. |
| `audit.py` | EVALUATION.md, team/B_PREDICTION.md and this report's saved-evidence check. |
| `test_prediction.py` | R1 EVALUATION.md and current unittest discovery; preserved 13 tests. |
| `unit-tests.log`, `evaluation.log`, `audit.log` | Explicitly retained by EVALUATION.md as historical R1 execution evidence. |
| `results/metrics.json` | Produced by evaluate.py; read by audit.py; described in EVALUATION.md. |
| `results/fold_models.json` | Produced by evaluate.py; read by audit.py; folds and coefficients retained. |
| `results/predictions.csv.gz` | Produced by evaluate.py; read by audit.py; 48,000 held-out rows retained. |
| `results/candidate.json` | Produced by evaluate.py, hash checked by audit.py via provenance, EVALUATION.md; proposal only. |
| `results/checks.json` | Produced by evaluate.py, hash checked by audit.py via provenance, EVALUATION.md; prior stress checks. |
| `results/summary.csv` | Produced by evaluate.py, hash checked by audit.py via provenance, EVALUATION.md; prior summary. |
| `results/provenance.json` | Produced by evaluate.py; read by audit.py; exact R1 input/output/code identities. |
| `results/audit.json` | Historical output of audit.py; referenced by EVALUATION.md; not overwritten. |
| `NOTES.md` | SYSTEM.md/team brief; current-round handoff only; prior notes retained at fd7fe29. |
| `readiness_audit.py` | R2 team brief, this report's CLI and test_readiness.py imports; offline audit only. |
| `test_readiness.py` | R2 team brief and unittest discovery; 23 adversarial cases and fixture factory. |
| `ROUND2.md` | R2 team brief and NOTES.md; interpretation, matrix, input hashes and inventory. |
| `round2/readiness.json` | Readiness CLI output; this report/NOTES.md/validation.json; scoped details and exact inputs. |
| `round2/prior-audit.json` | R1 audit rerun into R2 output; this report/NOTES.md/validation.json; previous evidence preserved. |
| `round2/tests.log`, `round2/readiness.log` | Final implementation checks; referenced by this report and validation.json. |
| `round2/validation.json` | This report/NOTES.md; commands, successful exit codes and exact code/output hashes. |

All R2 authored paths are B-owned. Publication delivers these offline results for A's independent review and does not imply integration or deployment acceptance.
