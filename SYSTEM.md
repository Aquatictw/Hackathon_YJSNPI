# grp6 RTDI system

Updated September 19, 2026. This is the single authority for status, architecture requirements, contracts, runbook and acceptance. [AGENTS.md](AGENTS.md) owns assistant instructions; [team/](team/) contains assignments only.
Machine-running code and correlated evidence are golden. Local source defines local behavior; newer source does not prove deployment. Historical packages/captures remain revision-specific evidence.

## Status and evidence

| Scope | Result | Evidence / limit |
| --- | --- | --- |
| Recorded deployment | Alert JSON fix built/pushed as `unifiedserver.local/grp6/py-app:20260919T084518Z`; 31 packaged tests and real SDK Monitor construction passed. Both descriptors pinned; AppDeployer stop/start exited 0; fresh Monitor at 08:58:24 UTC. | [Deployment observation](results/vm_production/alert_fix_deployment_20260919.json). Actual Edge image digest and fixed anomaly delivery still unverified. |
| Engineering history | Six stages × four sites, full selected-feature coverage, 24 actuals, six successful tester actions; callback latency 0.419–1.741 ms. | [Engineering evidence](results/vm_engineering/); delayed-data recovery and accuracy tolerance remain open. |
| Production run 3 | 80 devices, 74 pass / 6 fail; 120 requests, 480/480 actual joins; continuous sequence 1–765. Strict action validation fails on sequence 319. | [Strict audit](results/vm_production/strict_action_audit_20260919.json) supersedes the old callback pass; counts/integrity remain intact. [Report](results/vm_production/grp6_core_prod3_report.html); max callback latency 8.350 ms. |
| Prediction / anomaly receipts | 120/120 prediction action matches with successful adjacent execution. All three device-32 anomaly IDs reached TCCT On_POSTBIN output. | [Prediction audit](results/vm_production/tester_receipt_audit.json), [receiver observation](results/vm_production/receiver_observation_20260919.json). Anomaly parsing/execution/display remain unverified. |
| Local core | 46 tests pass, including native action JSON normalization and strict audit checks; 31 runtime tests passed in the uploaded release bundle. | Runtime fix deployed via pinned descriptor; later strict audit remains local. The older [37-test log](results/merged_core_tests.log) is historical. |
| Local dashboard/backend | Homepage already consumes persisted snapshot/SSE/chat. Real AI investigation called two tools and stored its answer/evidence/trace in local D1. | Recorded migration/14 replay records/SSE/480-character answer; this is beyond a prototype, but not cloud/live transport acceptance. |
| Integrated backend/frontend | D per-site projection/measurement API and E scoped UI/command states/provenance merged. 58 frontend tests, TypeScript and production build pass; A fixed mixed-source/ambiguous joins and command receipt projection. | [Integration checks](results/integration_20260919.json). No new hosted or machine transport acceptance. Older frontend logs remain historical. |
| B/C offline proposals | B: 13 tests and saved evidence audit pass; sparse fallback improves synthetic missing-input availability but standalone accuracy regresses in five stages. C: 11 tests and evidence audit pass; 6/7 coverage unchanged, W25 missed, two extra alerts. | [B evaluation](workstreams/prediction/EVALUATION.md); [C proposal](workstreams/detection/PROPOSAL.md). Keep primary models; reject C promotion. No runtime/artifact change. |
| Offline analysis | 25 CSVs, 2,000 devices, 3,036 measurements; six Ridge models, five wafer-separated folds; 12,000 replay predictions, expected category on 6/7 labeled anomaly wafers. | [Validation](grp6_app/artifacts/validation.json), [wafer/site validation](results/model_revalidation/validation.json), [replay](results/replay/summary.json). W25 spread decrease missed. |

Browser SSH confirmed `group-6` at **08:58:37 UTC, September 19**. The uploaded fix built/pushed and the pinned app restarted successfully; fresh live Monitor sequence 1 has model `752e…`. Before deployment, VNC showed TCCT bound/IDLE, 80 devices (74 pass / 6 fail). No new lot has run. Nexus was not restarted; the final `systemctl is-active nexus` probe returned unknown, so it is not current service-health proof. Historical [diagnostic record](results/vm_production/serialization_diagnostic_20260919.json) remains unchanged.
Confirmed defect: production sequence-319 get_prod contains a literal LF inside a JSON string. Native SDK reproduction and four normalization regressions pass. **The release is activated via a version-pinned descriptor; actual Edge image identity and anomaly execution/display acceptance remain open.** The revised local audit rejects historical sequence 319 at column 256; the old zero-error audit did not validate embedded response strings. Git integration took priority before the planned lot verification.
Historical receiver follow-up: TCCT plugin/library logs contain all three anomaly IDs at logged times 15:06:01 and 07:06:01.038; preserve both clocks until timezone alignment is verified. ProdMessage has no matching IDs. This proves receiver-boundary arrival only. Logs were preserved at **08:36:36 UTC** in `/home/user/Case_Event/grp6_receiver_evidence_20260919_pZGgeO.tgz` (final character uppercase O); hashes and limits are in the [transcribed observation](results/vm_production/receiver_observation_20260919.json).
Production JSONL SHA256: `dcd2fda6e8b09dd9fb51f9c713098c756abd1d24caece813a709af6bcd8fa4af`; engineering: `274c1892e177dc6834bfd6931b8924c560e53fb9a5f367766434591fbedb4da3`.
Recorded production model SHA256: `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`. Preserve image/model/evidence; do not repeat production merely to reproduce existing proof.
Earlier production run 1 lost deployment during session recreation and recovered mid-lot; run 2 captured only 317 events after late collection. Both are partial. Run 3 used five-second EdgeLog snapshots; its startup-only pre-lot process remains in `grp6_core_prod3_capture_all.jsonl`, outside the audited process.

## Requirements and architecture

The [competition brief](Question_20260919.pdf) describes anomaly analysis/reporting and stage-timed temperature prediction; our scope covers both. Page 6 requires `ActionManager.set_message(tc.testerId, message)`. Website/LLM are extensions, not stated prerequisites.
Scoring: scenario fit 10%, Gemini operation 25%, correct timing 25%, analysis method 15%, report presentation 25%. Deadline/submission format, presentation duration, accuracy tolerance, physical units and effective TP timeout remain unconfirmed. No score is guaranteed.
Real-time path: `SmarTest/TP → Nexus → Edge ONEAPI → scoped features/models/detectors → ActionManager → tester`.
External path: `Edge background outbox → HTTPS ingest → D1 → snapshot/SSE → website/read-only LLM`. Backend command polling/execution on Edge remains an integration requirement.
Edge inference/basic alerts must survive backend or LLM failure. Browsers never connect directly to Nexus or hold model API keys. LLM investigation runs in the background; synchronous predictions do not wait for external inference.

| Stage | Target / CSV pin | Latest eligible flow | Eligible features | Five-fold MAE (CSV units) |
| --- | --- | --- | ---: | ---: |
| 1 | `100_Main.sensor1_CP` / `sensor1#CP` | Suite1–14 + IDDQ_flow, before sensor1 | 25 | 0.003488 |
| 2 | `120_Main.sensor2_DS0` / `sensor2#DS0` | subflow1, before sensor2 | 525 | 0.026927 |
| 3 | `140_Main.sensor3_IO4` / `sensor3#IO4` | subflow2, before sensor3 | 1,025 | 0.020418 |
| 4 | `160_Main.sensor4_IO1` / `sensor4#IO1` | subflow3, before sensor4 | 1,525 | 0.024779 |
| 5 | `180_Main.sensor5_IO2` / `sensor5#IO2` | subflow4, before sensor5 | 2,025 | 0.063132 |
| 6 | `200_Main.sensor6_IO3` / `sensor6#IO3` | subflow5, before sensor6 | 2,525 | 0.027588 |

Order: request1 → sensor1 → subflow1 → request2 → … → request6 → sensor6 → subflow6. Use nested TP flows in source_review; test numbers/CSV order alone do not establish causality.
Current models exclude all sensor targets, final bins, pass/fail, total test time and wafer labels. Ridge selects ≤32 features; selection/imputation/scaling fit training folds only (wafer number modulo 5). Report held-out MAE/RMSE, baseline comparisons and wafer/site coverage; fitted replay error is not independent validation.
CSV row 0 begins PID/Lot/Wafer/Site/X/Y/PF/SBin/HBin/Test Time (3,046 columns); rows 1–4 are metadata, devices begin at row 5. Measurements use `<test number>_<suite>#<pin>`. SBin 1 is PASS; 2–32 FAIL. Preserve hex flags such as `0x0`.

| Evaluation label | First expected-category alert (completed devices) |
| --- | --- |
| W1 site imbalance | 32 |
| W3 / W9 low yield | 32 / 72 |
| W14 / W18 mean up / down | 32 / 32 |
| W23 / W25 spread up / down | 40 / missed |
| Remaining wafers labeled normal | W2 measures 53.75% yield: retain its valid low-yield alert despite label. |

Labels are evaluation metadata, never runtime rules or answers supplied to an online LLM. W6/12/15/21/24 had zero alerts but were inspected during tuning; they are not independent holdouts. Exact anomaly onset is unknown.
Detection combines normal baselines, per-test thresholds, related-suite agreement and persistence. Low yield uses completed-device SBin=1, minimum 32 devices, 80% threshold and a one-sided 95% Wilson upper bound before wafer end. Control multiple-testing false alarms; separate warming-up from normal and baselines from current-wafer windows.
W25 diagnostics found family gates below threshold and no qualifying family under normal-minimum ×0.7 spread screening. C evaluated a bounded spread-down candidate across all 25 wafers: W25 still missed; added alerts W1@56 and W23@80; scan cost increased. Reject promotion and retain production thresholds. These wafers are reused development data, not an independent holdout.

## Runtime invariants and machine protocol

1. Inspect `data.getType()` before legal getters; copy native values inside consumeData before return. Update current features before requests can overtake them. Preserve supplied SDK wrappers/native libraries.
2. Isolate run/tester/lot/wafer/device/site and verified head/attempt. Device identity is test UUID + site, separate from PartID; multi-head site collisions/mixed-scope touchdowns fail closed. Tests 20/21 decode lot ASCII chunks; test 25 decodes wafer even without WaferStart.
3. consumeTPRequest receives/returns strings. Java sends key=predict,data=N (1–6), AppLoc=edge, timeout=1 of unverified effective units. Reply `prediction N: (site,value) ...` through `set_wait(tc.testerId, 10, message)` then get; 10 is not an established deadline.
4. Feature wait releases the callback lock for ≤200 ms and rejects lifecycle changes. Never fabricate predictions for unknown stages/missing data or invent TP error shapes. Preserve per-site coverage, missing features, wait/lifecycle flags and latency; live timeout/failure acceptance is open.
5. Anomalies use set_message; key=prod_action retrieves get_prod separately from prediction get. Setter False is failure. Queued, returned-to-callback and tester-confirmed require different evidence; preserve final pending messages until retrieval.
   TCCT config runs msg at On_POSTBIN; receiver logs explicitly show a 2-second prod_action timeout. Prediction timeout units remain unverified. On_POSTBIN alone does not establish a poll after final-boundary alert emission.

Network/LLM/report generation stay outside callbacks; detector work and JSONL/stdout writes remain synchronous and require load measurement. Memory enqueue is not durable storage.
prod_action handling preserves valid JSON byte-for-byte, escapes native string control characters without changing message text, and rejects other malformed responses with request_error/empty reply. Evidence retains raw/normalized JSON and drained candidate IDs; returned_to_callback_unconfirmed never proves tester receipt. This normalization is in the newly pinned release; live delivery validation is pending.
Raw logs include run/event/request/prediction/device IDs, process-local sequence, model SHA and scope. Only the first 12 mapped measurements are sampled: JSONL is not a complete measurement feed. Keep request_error/callback_error/action_error/report_error visible.
SDK getters supply HeadSite/site, test/suite/pin, raw value, unit/scaling, flags, limits, bins and coordinates. Unit/invalid-bit/retest semantics need live verification. Missing bin/setup.cfg is valid in the tested SDK; do not restore that installer prerequisite.

## Data formats and display semantics

| Boundary | Version | Time / discriminator / provenance | Source |
| --- | --- | --- | --- |
| Raw core JSONL | numeric `1` | ISO timestamp + Unix-seconds time; kind/tester/source_mode | grp6_app/monitor.py log() |
| Optional gzip exporter | string `1` | Unix-seconds timestamp; event_type/tester_id/mode | monitor.py event(), exporter.py |
| Normalized backend / adapter input | numeric `1` | timezone-qualified ISO timestamp; type/tester_id/source_mode | frontend/lib/rtdi/wire.ts, exporter-wire.ts |
| Internal UI view model | string `0.1-draft` | ISO sent_at and record times; records | frontend/lib/rtdi/contracts.ts, frontend/contracts/schemas.json |

Version 1 alone does not identify a format. Exporter-shaped batches accept numeric or string 1 through normalization; raw JSONL and retired nested DashboardEnvelope are not direct frontend batches.
Normalized envelope: `{schema_version:1,edge_id,batch_id,events}`. Each event requires event_id/type/run_id/tester_id/timestamp/source_mode. Types: measurement, prediction, prediction_actual, evidence, heartbeat, run_summary; source live/replay/simulation. Strict batches contain 1–100 events.
Use [wire validator](frontend/lib/rtdi/wire.ts), [wire schema](frontend/contracts/edge-v1.schema.json) and [formal fixture](frontend/contracts/examples/edge-v1-batch.json); the fixture is neither raw JSONL nor exporter format.
Prediction requires request_id/stage/device_id; actual requires request_id/actual. Join uniquely by run/tester plus applicable device/site; request_id alone cannot join across scopes. Raw requests have per-site prediction_ids/device_ids; preserve original request and per-site identity.
Legacy edge-adapter uses wire request_id as UI prediction_id: use per-site prediction identity there, retaining original request provenance without violating strict schemas. Same-ID/different-content is a conflict; UI conversion must avoid globally colliding IDs from scoped backend keys.
Alert payload: kind/message/test/site/completed_devices/observed/reference/score/series/site_series, baseline(mean/sd/thresholds) or null for yield, suggestion and optional family score/persistence. Score is not probability.
Replay summary carries mode/live_integration/wafers/expected_anomalies_detected/expected_anomaly_wafers/max_scan_ms/max_model_ms/prediction_in_sample_mae/validation.metrics/limitations. Wafer entries contain devices/yield/expected/expected_first_device/alerts; metrics contain n/mae/rmse/worst_error/baseline_mae.
Series indices are completed-device order within each site, not timestamps or spatial maps. Yield is 0–1, displayed as percent. Normalize raw string sites/number wafers at boundaries: formal site_id is numeric, lot/wafer IDs strings. Unknown scope remains unknown.
Coverage=1 means selected inputs present, not perfect accuracy. Empty predictions mean unavailable, never zero. Units stay CSV units/unverified; synthetic °C fixtures prove no machine units. Replay timestamps are ordering aids; saved live provenance does not imply a current stream.

## Implemented local API and UI

Routes below use `/api/v1`. No public deployment/container reachability is established. **No user authentication exists** on snapshot/SSE/incidents/chat/command creation; same-origin checks are not authentication. Public deployment requires user/team/run authorization and durable rate/cost controls.

| Method / route | Current contract |
| --- | --- |
| POST /events/batch | Bearer INGEST_TOKEN; durable D1 ingest, scoped event/batch idempotency, accepted/duplicates/rejected ID arrays; conflicts 409. Formal JSON ≤256 KiB; exporter ≤4 MiB compressed / 8 MiB decompressed, gzip supported. |
| GET /runs/{id} | Snapshot run/events/evidence/incidents/commands; optional tester_id; ambiguity 409, absent run 404. |
| GET /runs/{id}/events | Optional tester_id; Last-Event-ID or cursor query; ready/edge_event/heartbeat/stream_error; D1 row cursor, 25-second cycles, 10-second heartbeat. |
| GET /runs/{id}/measurements | Required tester_id/event_id; offset ≥0 (max 100,000), limit 1–100 (default 50). Returns metadata/measurements/total/offset/next_offset; 422 invalid query, 404 missing scoped bundle. Raw reconstruction ≤8 MiB/17 chunks; response <256 KiB. |
| GET /incidents/{id} | Optional run_id; **no tester_id selector**. Repository scopes incident/evidence; unresolved ambiguity 409. |
| POST /runs/{id}/chat | mode=openai/question, optional tester_id/incident_id/history; persists answer/evidence IDs/tool trace. Same-origin guard permits absent Origin; no user identity. |
| POST /runs/{id}/commands | Same-origin Origin, user_confirmed:true, request_id/incident_id/kind=show_message/message ≤500 chars; optional tester_id query; live runs only, TTL 30–300 s (default 120), idempotent request ID. |
| GET /commands/pending | Separate bearer COMMAND_TOKEN; tester_id required, run_id optional; unexpired queued commands. |
| POST /commands/{id}/results | COMMAND_TOKEN; ack_id/run_id/tester_id/status/occurred_at, optional receipt/detail; idempotent ACK and forward-only transitions. |

States: queued → received → queued_to_tester → tester_confirmed, plus rejected/failed/expired. Transitions may skip intermediate stages; command-contract.ts is authoritative. tester_confirmed requires tester_receipt_id, with real correlated evidence needed for live acceptance.
Dashboard labels, UI contracts and validation use all seven backend states, including rejected. Snapshot commands include the receipt from the latest persisted ACK matching command/run/tester/current status, or null. Displayed confirmation is a backend report, not independent machine proof.
LLM tools are read-only get_run_summary/get_incident_evidence/compare_sites, bounded to six calls and a 20-second investigation deadline. Cite only returned evidence; distinguish facts/hypotheses/actions; treat source text as untrusted; preserve trace/model/errors. No AI tool sends commands or silently falls back to fixed-rule answers.
Homepage `/` already scopes snapshot/SSE, displays source/site evidence and persisted AI, refreshes commands on heartbeat, retains data while reconnecting and clears failed lookup scope. Prediction/command displays are read-only; no command-creation UI exists.
`/replay` loads offline summary (browser import ≤5 MB, no upload); `/sandbox` retains synthetic/JSON and explicit rule-based demo. Non-v1 /api/assistant and /api/config remain A-owned. Reload clears visible chat; D1 investigations persist but history listing is not exposed.
Homepage reads normalized evidence directly; the adapter now retains 320-point series/site series, scalar thresholds, coverage, receipts and the original source batch. UI records and displays retain original_request_id/source_event_id; UI validation aliases the canonical wire validator. Snapshot prediction joins require compatible run/tester/source/request and supplied device/site/stage/lot/wafer/attempt/original-request scope, with one distinct matching actual event. Equal-valued distinct actuals remain ambiguous; exact event retries deduplicate. Scalar thresholds remain separately labeled until their scale is verified. Current replay has no predictions, so its prediction panel is correctly empty.

## Exporter limits and live enablement

Unset GRP6_EXPORT_URL disables exporting. Otherwise callbacks enqueue copied events; a worker commits SQLite then sends gzip HTTPS with stable IDs. Plain HTTP is allowed only for localhost.
Config: GRP6_EXPORT_URL (actual HTTPS /api/v1/events/batch), GRP6_EXPORT_TOKEN (secret), GRP6_EXPORT_OUTBOX=/tmp/grp6_export.sqlite3, GRP6_EDGE_ID=grp6-edge, GRP6_EXPORT_QUEUE=32, GRP6_EXPORT_BATCH=1, GRP6_EXPORT_TIMEOUT=5. Verify persistent storage before relying on /tmp.
DeviceCompletedBundle includes full measurements, raw units/scaling/limits/flags, head/site/coordinates/bins, part/device and quality counts. attempt=null / attempt_status=unverified_sdk_field is intentional; live getter semantics/completeness remain unverified.
Lot-start detector_baseline_artifact includes runtime SHA, 3,035 baselines, test/family thresholds and baseline wafers. Legacy mean is nanmedian, labeled median_stored_in_legacy_mean_field; training counts/missing rates/build time/live units are unavailable.
Backend retains exporter payloads in raw_events/raw_event_chunks as base64 chunks ≤500,000 raw bytes. Alerts project to evidence/incidents; other source records remain run_summary. Prediction requests/actuals also project to scoped per-site records in the same transaction; ACK IDs remain original exporter IDs. request_id is per-site identity, original_request_id preserves the callback request, source_event_id preserves its source. Missing actuals remain raw only; unknown units remain null. Device bundles are available through the scoped measurement API. Existing summaries are not automatically backfilled; unchanged events in a new batch can create missing projections, while same-batch retries remain duplicates.
Memory enqueue precedes durability; nested copies are shallow; any HTTP 2xx currently retires the entire batch without per-event ACK checks. Nonfinite data/completeness semantics need hardening before live enablement.

1. A/D establish permitted export/redaction, HTTPS deployment, D1 migration, token delivery/rotation and raw-retention/observability ownership; never commit credentials.
2. A hardens ACK handling: accepted/duplicate can retire; rejected are isolated; 400/422 quarantine, 401/403 fix auth, 409 resolve identity, 413 split, 429/5xx/network retain stable IDs and back off with jitter.
3. D/E verify raw-to-normalized-to-display scope, units, predictions/actuals and command semantics locally; A integrates runtime changes.
4. A tests actual-container DNS/TLS/gzip near-limit device delivery, restart/outbox recovery and local inference during outage. Development SSH alone proves no app-container egress; use an approved HC relay or honestly labeled manual export/replay if needed.

## Local runbook

Node ≥22.18; lockfile governs dependencies. Python runtime/replay use stdlib; training needs NumPy; native ONEAPI belongs in supplied Python 3.10.
Keep OPENAI_API_KEY/OPENAI_MODEL/random INGEST_TOKEN in ignored frontend/.dev.vars; COMMAND_TOKEN is separate. Restart after configuration. No secrets in examples, browser bundles, NEXT_PUBLIC_/VITE_ variables, docs or logs.

1. In frontend/, use `npm ci` if dependencies are absent, then `node scripts/local-backend.mjs migrate` and `npm run dev -- --host 127.0.0.1`.
2. In a second frontend terminal, run `node scripts/local-backend.mjs seed`; localhost-only, retry-safe, no AI call. Load `http://localhost:5173`, run grp6-replay-demo / tester grp6-replay.
3. Verify frontend with `npm test`, `npx tsc --noEmit`, `npm run build`. A verifies core with `python -m unittest discover -s grp6_app/tests -v` from root. Record actual revision/results, not inherited counts.
4. A can regenerate replay with `python -m grp6_app.rehearse source_review/training/Data --output results/replay`; frontend `node scripts/sync-replay.mjs` validates/copies public data with source SHA. These overwrite A-owned outputs; B/C output only inside their workstreams.

`npm run replay:edge -- --run-id <id> --started-at <ISO>` converts/validates deterministic evidence batches; no network without --endpoint. Replay times are synthetic ordering. build_models/calibrate overwrite default artifacts: only A promotes reviewed candidates.
After integration, C's evidence/ownership check is `python -B -m workstreams.detection.verify --contribution-ref 5f403bd`; this scopes ownership to C's delivered commit while checking current evidence. B/C auditors accept only LF/CRLF equivalents for source files when a raw hash differs; data/model/output hashes remain exact and recorded evidence is unchanged.

## Remote runbook — A only

Only grp6: verify group-6 and dashboard rows grp6_acs_host_controller/grp6_acs_edge_server. Never use grp1 results as readiness evidence. User handles all local/remote uploads/downloads; A prepares/verifies exact artifacts. Preserve originals and coordinate sessions; **never restart Nexus during SmarTest**.
Uploaded immutable release: `C:/Users/USER/Downloads/grp6_core_alert_json_fix_20260919.zip`, **337,747 bytes**, SHA256 `6522964d0e1deffa16ca0d50c5cd1909b7172b9bd565efc6c1a92c034a9264fa`. Verified on group-6 at 08:44:21 UTC and extracted to `/home/user/Case_Event/grp6_alert_release_20260919_UcetMt`; 31 packaged tests and SDK Monitor construction passed. It excludes later local audit/D/E changes. Keep its build/stop/start/Edge logs and backups; do not replace the archive under the same name.

| Resource | Recorded location |
| --- | --- |
| Host / Edge | 180.3.13.36 / 180.3.13.209; recheck named rows on reconnect. |
| Host package / SDK | /home/user/Case_Event; Edge/oneAPI_py3.10/bin; training/Data. Host Python 3.6.8. |
| Edge development | debugger@advantestcell.local:29022; code-server http://advantestcell.local:29080/?folder=/home/debugger/project; project → /data/project, SDK oneapi_sdk. |
| Container | Python 3.10.12, unifiedserver.local/all/template-data-app:v22.04; SDK/app /opt/nexus/OneAPI/bin, starts python3 -u main.py. |
| Descriptor | /home/user/Case_Event/SmarTest/app_descriptor.json and /opt/acs/nexus/conf/app_descriptor.json; py-app pinned to grp6/py-app:20260919T084518Z under unifiedserver.local. |

Dashboard: `https://sandbox.gemini.te-cloud.advantest.com/dashboard/virtual-machine`; recorded grp6 gateway tevmip-180-3-13-67-endtevmip. Rediscover tabs and use fresh VNC screenshots; typeText previously lost newlines, so verify entry. Host lacks rg; use grep/find/sed.

1. A packages with `python deploy/package_grp6.py --output <new-archive-path>`; CRC/per-file SHA checked, including SYSTEM.md. Existing ZIPs are unchanged historical evidence.
2. After user upload to /home/user/Case_Event, verify hostname, sha256sum, stat -c %s and unzip -tq; stop on mismatch. Extract to a new unused directory; run `python3 <release>/install_grp6.py --build --push > <new-log> 2>&1`; retain grp6_deployment_latest.json/digest.
3. Installer checks group-6/hashes, copies SDK to timestamped staging, edits staging main.py, builds versioned image, runs packaged tests and constructs real Monitor before push. Avoid destructive supplied tag.sh and stale grp6_app_upload*.zip scaffolds.
4. Preserve a healthy bound, idle session. Installed `/opt/acs/nexus/bin/AppDeployer --help` verifies `stop` purges and `start` deploys; 0 means success. Preserve Edge logs first, stop, verify removal, start, then check fresh Monitor and ACS Nexus GUI Information → Container Status (hover py-app for image:tag). Host Docker/registry digest alone is not actual Edge digest proof. Never clear internal state or restart Nexus to guess at recovery.
5. Only if session reconstruction is necessary, in /home/user/Case_Event/SmarTest run `DISPLAY=:1 XAUTHORITY=/home/user/.Xauthority bash runTp.sh load`; it recreates the workspace, kills SmarTest/TCCT and attempts AppDeployer start. Wait for SMT8 Ready and complete final image activation afterward. `bash runTp.sh eng_run 1` is engineering; `bash runTp.sh prod_run` also rebuilds the session and ignores its second argument. Prefer the already-bound production recipe after verifying readiness; recorded run 3 avoided launcher teardown this way.

runTp.sh copies descriptor each invocation. Save workspace/descriptor/deployment first; recorded backups: grp6_before_prod_workspace.tgz, grp6_deployment_before_core.json, grp6_descriptor_debug6.json. Collection used ONEAPI_DEBUG=1; supplied default 6 obscured early evidence.
Register Monitor before connect; zero connect return proves initiation only. Evidence defaults /tmp/grp6_evidence.jsonl and .html; GRP6_EVIDENCE may target verified persistent storage. Preserve before removal; reports refresh asynchronously every 32 devices/boundaries and drain at shutdown.
Collect `Edge/EdgeLog/EdgeLog log` periodically (five seconds captured run 3); end-only retrieval truncates, and --help also collects. Strip GRP6_EVIDENCE prefixes before JSONL auditing.
Report: `python3 -m grp6_app.report <jsonl> --output <report.html>`. Audit: `python deploy/audit_evidence.py <jsonl> --output <audit.json>` (bundle: audit_evidence.py at root). Require six stages/all sites/full coverage/no errors and separate tester EDL/UI receipts; callback audit alone is insufficient.
VM replay mounts host training/Data read-only and a dedicated output directory in the versioned image, overrides entrypoint to python3, runs `-m grp6_app.rehearse /data --output /out`. It needs no native connection/NumPy and must stay labeled replay.

## Provenance and retained references

| Historical artifact | Recorded identity |
| --- | --- |
| Core upload | 331,948 bytes; SHA256 c49930d9a7ecb55ad4a77a38a705c58095406be234572c21558bc4e8d07d762c. |
| Channel fix | grp6_channel_fix.zip, 311,583 bytes; SHA256 21c52ec6bd795414b61da86c8c49ba78f1e0cbab8a7466100bb7c69c13ffb270; tag 20260919T052422Z. |
| Original bundle/image | 310,207 bytes; ZIP SHA256 710f533122c86dfb43c847196e906de5b3d0b2f7242db21b2be604445eb22243; tag 20260919T044025Z, registry digest sha256:f7c19251a2c7eb7c106c7d762e38ba03d590f3e06f722a0c419fc543d1003efd. |
| Hex-flag image | livefix-20260919; digest sha256:81cd96f70948955b3010ba454e06ea43db68fc816278368607b5e77f787c4057. |

Keep [Question PDF](Question_20260919.pdf) (p3 labels/targets, p4 timing, p6 messaging), [Workshop PDF](WorkShop_Material.pdf) (p11 transfer, pp19–26 deployment, pp28–29 data), [ONEAPI Manual](ONEAPI_Manual.pdf) (Monitor/NexusData/ActionManager/lifecycle), tmp/pdfs extracted text and SDK/TP sources. Diagrams require original PDFs; supplied py-app.log is reference output only.
Keep data/models/packages/results/diagnostics, [frontend license](frontend/vendor/shadcn-tailwind-4.13.0.LICENSE.md), all skill files/licenses and [provenance](.agents/skills/i-have-adhd/UPSTREAM.json). Skill upstream b15d0be58f55b33972ba3e39709e0e5208ef30cb; AGENTS explicitly invokes it without modifying opt-in metadata.
Verified grp6_sources_data.zip: 12,571,563 bytes / 66 files in source_review. Earlier ~525 MB full archive's first local copy was truncated; do not use that partial extraction. Root/SDK requirements duplicates are intentional.
Superseded docs are backed up at C:/Users/USER/AppData/Local/Temp/grp6-docs-before-system-20260919; they are historical context, not current authority. Existing packaged docs remain revision-specific.

## Current orchestration round

Round **R2-20260919** is assigned in all four team briefs. Its exact base is the published handoff commit supplied at dispatch (the commit containing those briefs); each worker records it in notes. A uses C:/Users/USER/Documents/hackathon2026-a-core on local teammate-a-core. Only remote main is published.

The legacy first round is accepted at ec1bafc, with original D history and final E notes preserved through fd7fe29. Its explicit A dispositions and results/integration_20260919.json are the accepted migration exception to the newly introduced matching-round/COMPLETE markers; old assignments are not silently rerun. B 86445d7, C 5f403bd, D 3e5b829 and E final notes 06887ad are reachable from main. The recorded 128 tests, TypeScript/build and evidence audits apply to that accepted code; orchestration-only edits do not imply fresh machine checks. Prior notes remain at fd7fe29:workstreams/<role>/NOTES.md.

R2 ownership: B audits readiness/timing evidence and missing machine cases; C profiles detector cost and evaluates at most one output-equivalent optimization; D hardens atomic command lifecycle/expiry guards; E tests and fixes asynchronous dashboard scope/reconnect behavior. A handles exporter ACK/recovery, independent integration review and grp6 image/receipt verification. Workstream code, metrics, logs and proposals remain needed for reproducibility; no cleanup deletion or model/detector promotion is authorized by these assignments.

Acceptance requires four same-round COMPLETE handoffs, their committed evidence and delivery SHAs reachable from main, followed by A review and combined checks. R2 assignments are work in progress, not accepted behavior or deployment proof.

## Ownership and integration

A is core owner/integrator and owns everything outside explicit B/C/D/E allowlists: all core grp6_app, artifacts, deploy/VM, results/source data, root docs/files, team briefs, manifests/lockfiles/scripts/shared configs/examples and non-v1 API routes. D's db/drizzle migration files are the explicit schema exception; deployment configs remain A-owned.
B owns files under workstreams/prediction/; C owns files under workstreams/detection/, including their NOTES.md. Both deliver offline proposals; A reviews/promotes accepted runtime/artifact changes.
D owns frontend/app/api/v1, db, drizzle, contracts/edge-v1.schema.json, enumerated backend lib/rtdi files and backend tests in [D assignment](team/D_BACKEND.md).
E owns enumerated UI pages/components/styles/hooks/libs, UI schema and dashboard/contracts/replay/ui-* tests in [E assignment](team/E_FRONTEND.md). No blanket app/ or lib/rtdi ownership; importing a file grants no write permission.
Freeze assistant.ts exports instructions/demoAnswer/ChatMessage and D-consumed behavior/signatures; agent imports instructions, chat-handler imports demoAnswer. Preserve compatible EventView/validatedView contracts. A coordinates breaking interface changes.
Each teammate maintains only their own notes: B workstreams/prediction/NOTES.md, C workstreams/detection/NOTES.md, D workstreams/backend/NOTES.md, E workstreams/frontend/NOTES.md. D/E own these exact notes files in addition to their frontend allowlists. Update Progress, Decisions, Blockers and Handoff after meaningful work and before stopping; include commands/results, evidence paths, base/branch SHA and next action. Replace stale status rather than appending diary entries. No credentials, copied canonical contracts or unverified success claims. Record required outside-scope edits with path/reason/requested owner, continue independent work, and leave those files untouched. A promotes verified decisions into SYSTEM.md; teammates do not edit SYSTEM, AGENTS or team briefs.

1. Remote `main` is the sole publication branch. Each role works in its own checkout/local branch: `teammate-a-core`, `teammate-b-prediction`, `teammate-c-detection`, `teammate-d-backend`, `teammate-e-frontend`. A publishes a numbered round and exact handoff SHA; new work starts there, never at a permanently hardcoded old base. Preserve unfinished work and never switch another agent's checkout. Current assignments identify the active round; start only from A's matching published handoff SHA.
2. Author only allowlisted files. Audit your individual commits, staged edits and untracked paths; after synchronization a base-to-HEAD diff also includes others' contributions. Notes include round ID, status (IN_PROGRESS/BLOCKED/COMPLETE), base SHA, contribution SHAs, commands/results, evidence and owner requests. The final delivery SHA goes in the response, not its own commit.
3. Keep synchronization minimal: fetch once at task start and once immediately before publication (reuse a fetch just completed for that purpose). Merge `origin/main` into your local branch only when it is not already an ancestor of HEAD. Run assignment checks once on the final implementation; after incoming changes rerun only affected checks, preserving recorded results for unchanged code. Push explicitly with `git push origin HEAD:refs/heads/main`. Never publish local role branches or force-push. A successful push confirms publication; fetch again only for rejection, uncertain outcome or a new review boundary. On a race, fetch/merge/recheck only the new delta and retry; on a permissions/network failure diagnose instead of looping. Abort conflicts outside your allowlist and coordinate with A; never discard another owner's changes.
4. Teammates report COMPLETE only after checks and confirmed publication, then stop editing until A reviews or reassigns. A batches review after all four same-round handoffs arrive, verifies delivery commits are reachable from main, reads notes/outputs and runs combined acceptance once per round; repeat only for relevant fixes/new code. Main may contain work awaiting review: publication is not acceptance or deployment. A records the reviewed revision and open gates in SYSTEM, cleans only verified obsolete files while preserving reproducibility/rollback evidence, and rewrites all four team/ assignments for the next round.
5. Reusable instructions: [orchestrator prompt](prompts/ORCHESTRATOR.md) and [teammate prompt](prompts/TEAMMATE.md). Only A uses grp6 VNC/SSH and promotes runtime changes; the user handles local/remote transfers. Prefer completion notifications to repeated fetches. Without notifications, inspect for delivery no more than once every five minutes while doing independent work; an unchanged head requires no merge/recheck. Do not claim unattended continuation without an authorized scheduler.

Following allowlists prevents overlapping file edits. It cannot guarantee 100% semantic compatibility; shared interfaces still need integration checks. D/E verify shared interfaces; A integrates D/E with scoped snapshot/SSE/prediction/receipt checks and evaluates B/C proposals before core promotion. Assignments: [B](team/B_PREDICTION.md), [C](team/C_DETECTION.md), [D](team/D_BACKEND.md), [E](team/E_FRONTEND.md).

## Remaining acceptance gates

| Gate / owner | Evidence needed |
| --- | --- |
| G1–G2 / A, B proposals | Units/scaling/flags/deadline; unknown/missing/error replies; late data/timeout, retest/head/wafer/reconnect isolation on machine. |
| G3 / C → A | All-wafer candidate evaluation delivered and rejected: 6/7 unchanged, W25 missed, two additional alerts. Improved W25 coverage and independent validation remain open. |
| G4 / A | Pinned deployment/fresh Monitor observed. Still required: actual Edge image verification and real anomaly → set_message → get_prod → correlated tester receipt, including final-message delivery. |
| G5–G6 / D/E → A | Projection, scoped measurement access, identities/series/coverage/receipt display pass combined local tests. Complete live reports, public user auth and transport acceptance remain open. |
| G7–G8 / A/D/E | Actual-container HTTPS/outbox/DB/SSE, bounded callback load, outage/retry/restart recovery, expired/duplicate/wrong-run command rejection, real tester execution and release rehearsal. |

Demo: source/freshness → stage predictions/actuals → anomaly/site evidence with truthful receipt state → persisted AI citations → labeled replay fallback. W1/W3/W14/W23/W25 cases include explicit W25 no-alert state. Keep focus indicators, reduced motion and responsive evidence views; missing records never imply normal.
