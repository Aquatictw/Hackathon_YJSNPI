# grp6 contest plan and working notes

Updated: 2026-09-19. Contest is in progress. This is the authoritative current plan and resume document.

## Team and verified state

- User instruction: update this file before every context compaction with verified findings, edits, validation, unresolved issues, and exact next steps. Never store credentials or tokens.

- **We are grp6. Use only grp6 machines.** Previous grp1 activity is historical and proves nothing about grp6.
- Gemini dashboard rows: `grp6_acs_host_controller` (`180.3.13.36`) and `grp6_acs_edge_server` (`180.3.13.209`), observed Up; verify named rows on reconnect.
- Remote host verified as `group-6`. User opened the SSH terminal in `/home/user/Case_Event`; the prompt confirms `[user@group-6 Case_Event]`.
- Remote Firefox successfully authenticated to code-server at `http://advantestcell.local:29080`. Edge workspace `/home/debugger/project` still needs inspection on grp6. Use remote code-server for development as requested.
- Current SSH browser tab is on the grp6 gateway `tevmip-180-3-13-67-endtevmip`, client suffix `/client/MgBjAG15c3Fs`. Rediscover tabs rather than assuming IDs.
- Local challenge PDF: `Question_20260919.pdf`. All seven pages read, including the wafer table and flowchart images. Extracted text: `tmp/pdfs/Question_20260919.txt`.
- Verified remote training files under `training/Data`, including `A12345_W09_RawResult.csv` through `A12345_W25_RawResult.csv`, corresponding STDF files, and `training/TrainDataInfo.txt`. Full count and schema remain to be checked.
- Verified host SDK files: `Edge/oneAPI_py3.10/bin/main.py`, `oneapi.py`, `FileTransfer.py`, `AdvantestLogging.py`; parent has `requirements.txt`, `py-app.dockerfile`, `tag.sh`, and a reference `py-app.log`.
- **Current: six models trained; production SDK adapter, detector and report implemented locally. Live integration and VM deployment remain unproved.** See latest checkpoints below.
- Keep passwords and authentication tokens out of notes and source.

## What the challenge asks for

Source: `Question_20260919.pdf`, pages 1–7.

Build an intelligent assistant for semiconductor test data in ACS RTDI/Gemini. The brief describes two scenarios; it does not explicitly say both are mandatory. Our proposed scope covers both with a shared data pipeline, finishing one reliable end-to-end path before expanding.

1. Detect anomalies during simulated production and provide an organized report that people can query or receive. Page 6 additionally requires anomaly messages back to the tester through `ActionManager.set_message(tc.testerId, message)`. A local searchable report meets the query option without needing external messaging.
2. Predict IC temperature when the test program sends a target number to the container, then return the prediction to the test program.

Scoring: **completion 60%** = scenario fit 10% + successful operation on ACS Gemini 25% + correct timing of detection/prediction 25%. **Innovation 40%** = analysis method 15% + innovative anomaly report presentation 25%. Prioritize the full 60% completion category: satisfy the scenario requirements, demonstrate operation on grp6 Gemini, and detect or predict at the correct time. An understandable, evidence-based report also supports the innovation category.

Training set described: 25 wafers × 80 devices, approximately 3,000 tests/device. CSV columns use `<test number>_<test suite name>#<pin name>`. Parse metadata rows separately from device rows; confirm actual headers before coding.

| Request number | Temperature target | Latest allowed measurements (flowchart, page 4) |
|---|---|---|
| 1 | `100_Main.sensor1_CP` | Initial suites and IDDQ flow, before sensor1 and subflow1 |
| 2 | `120_Main.sensor2_DS0` | Results through subflow1, before sensor2 |
| 3 | `140_Main.sensor3_IO4` | Results through subflow2, before sensor3 |
| 4 | `160_Main.sensor4_IO1` | Results through subflow3, before sensor4 |
| 5 | `180_Main.sensor5_IO2` | Results through subflow4, before sensor5 |
| 6 | `200_Main.sensor6_IO3` | Results through subflow5, before sensor6 |

**Never use future measurements during training or inference.** Derive six feature allowlists from the actual test program order, not numeric test IDs or CSV column order. Earlier sensor values may be eligible only if they actually arrive before the request; the target itself is never an input. Final bin, final pass/fail, total test time, and wafer labels are not prediction inputs.

Verified labels agree between page 3 and remote `training/TrainDataInfo.txt`:

| Wafer | Labeled condition |
|---|---|
| W1 | Site imbalance |
| W3, W9 | Low yield, below 80 |
| W14 / W18 | Mean trend up / down |
| W23 / W25 | Standard deviation trend up / down |
| All other wafers W1–W25 | Normal |

Treat low yield as below 80% after confirming the data's pass/fail encoding. Labels identify training examples, not a lookup table for live classification.

## Build order and completion gates

Time boxes below are estimates, not a known contest deadline. Re-budget after the first integration check.

### 1. Prove the connection and request contract — first 20–30 minutes

- Inventory `training`, `Edge`, and `SmarTest`; inspect `runTp.sh`, app descriptor, SDK sample, test flow, and `receive_temp_predict1` through `receive_temp_predict6`. Preserve originals.
- Read the TP request and response schema, site routing, units, timeout, and error behavior. The PDF specifies target numbers but not the complete wire format.
- Inspect grp6 code-server workspace and SDK/dependency versions. Establish which files live on host versus Edge and how the workshop build consumes them.
- Start the untouched sample before a controlled engineering run. Inspect the grp6 run script before invoking it; an older grp1 script copied an app descriptor on every invocation, but grp6 behavior is unverified.
- Verify actual measurements, device/site identity, lot and wafer boundaries, prediction requests, and responses. Connection success alone is insufficient.
- Gate: capture one real request/response round trip, the relevant measurements, and the tester accepting a response. Any provisional baseline response must be visibly identified as a baseline.

### 2. Build one shared ingestion and replay layer — next 30–45 minutes

- Parse all 25 CSVs, metadata rows, limits, test names, missing values, site, device, and chronological order. Confirm shape and target coverage.
- Build a test-order manifest from the real program; generate the six allowed feature lists.
- Normalize live and replay data to the same measurement representation, keyed by tester/lot/wafer/device/site/test/pin. Keep lifecycle state isolated and reset it at the proper boundaries.
- Copy event values inside `consumeData`; do not retain SDK payload objects after return. Update a small per-device feature cache promptly; put heavier analysis and reporting on a bounded worker queue.
- Detect queue overflow and missing events explicitly. Never silently report stale predictions as current.
- Gate: a CSV replay and a live device produce matching feature identities; current-device features cannot leak between sites or devices.

### 3. Finish the anomaly scenario — next 45–60 minutes

- Learn robust per-test baselines from training normal wafers. Begin with interpretable detectors rather than a classifier trained on a handful of labeled abnormal wafers.
- Detect site imbalance using comparable per-site distributions; low yield from completed-device results; mean drift with rolling/EWMA summaries; spread increase/decrease with rolling dispersion relative to baseline.
- Tune minimum sample counts and persistence on training partitions. Aggregate related alerts across thousands of tests, suppress repeats, and distinguish insufficient evidence from normal.
- Evaluate false alarms on held-out normal wafers. Replay abnormal wafers in chronological prefixes to measure when each alarm first becomes possible; report small-sample limitations honestly.
- Send concise anomaly messages using the actual `tc.testerId` and the SDK sample's ActionManager delivery lifecycle. Record send result separately from confirmed tester display.
- Gate: live anomaly → recorded evidence → local report → tester message observed. Preserve detection delay and false-alarm measurements.

### 4. Add six temperature models — next 45–60 minutes

- Train one model per request stage using only its allowlisted features. Start with a simple constant baseline and a regularized regression; compare a small tree ensemble if validation justifies it.
- Split by wafer, never random rows from the same wafer across train/test. Fit imputation, scaling, and feature selection only within each training fold. Reserve final held-out wafers where practical.
- Report per-target MAE, RMSE, worst errors, and performance versus the baseline. No accuracy target is specified in the PDF; use measured results and verify units.
- Preload model artifacts and use the latest stage-valid device/site feature snapshot at request time. Check event ordering between data callbacks and TP requests; a worker queue must not make the prediction stale.
- Unknown target, missing features, model failure, or timeout must use the TP's supported failure response, not an invented numeric prediction.
- Gate: all six request types receive correctly routed, correctly formatted responses within the actual TP timeout; replay proves no future feature use.

### 5. Present evidence clearly — budget 30–45 minutes, start with first anomaly

Build a compact local dashboard/report with: connection and data freshness; wafer/site overview; incident timeline; top affected tests; observed versus baseline plots; running yield; sensor predictions versus later measurements; request latency and response status.

Each incident explains what changed, where, when it was first detected, supporting measurements, severity, and a suggested next check. Provide filters and downloadable HTML/JSON/CSV evidence. Separate observed facts from suggested causes. A templated evidence narrative is sufficient; external AI services are unnecessary for the first delivery.

Gate: an unfamiliar reviewer can identify the affected site/test and understand the alert from one screen. Clearly label live, replay, and baseline modes.

### 6. Package and rehearse — reserve final 45–60 minutes

- Package tested code, model artifacts, feature manifest, and dependencies with the supplied Docker workflow; inspect `tag.sh`, registry target, and app descriptor first.
- Run through grp6's sandbox production workflow with the app available before lot start. Verify ONEAPI data, prediction round trips, anomaly messages, report updates, and clean completion from the deployed image.
- Save image identifier, model versions, validation results, logs, and a short runbook. Make a deterministic replay fallback from known input.
- Gate: repeatable end-to-end demo on grp6; do not substitute historical grp1 or supplied reference logs as evidence.

If time becomes tight, prioritize one complete anomaly scenario with tester feedback, report, and deployment. Keep prediction work progressing only if its request contract is proven. Reduce detector/model complexity before sacrificing integration or the final rehearsal.

## Proposed implementation layout

Keep supplied SDK modules intact; place the application alongside them in the remote code-server workspace.

```text
grp6_app/
  adapter.py            # ONEAPI callbacks, lifecycle, TP request/response
  state.py              # stage-valid per-device/site feature cache
  data.py               # CSV parsing and chronological replay
  detectors.py          # yield, site, mean and spread monitoring
  train.py              # wafer-grouped training and evaluation
  predict.py            # six model dispatch and input validation
  report.py             # local query UI and evidence export
  models/               # artifacts and feature manifests
  results/              # reports, metrics and run logs
  tests/                # leakage, lifecycle, routing and replay checks
```

SDK entrypoint integration and final placement depend on inspecting the actual grp6 `main.py` and build context.

## SDK details already checked

- Verified `Edge/oneAPI_py3.10/bin/sample.py`: `consumeTPRequest` parses JSON `key`, `data`, and `action`. For `key: predict`, `data` selects the prediction number. The sample builds `prediction N: (site,value)` for every site, calls `ActionManager.set_wait(tc.testerId, 10, message)`, then returns `ActionManager.get(tc.testerId)`. Its `25.22` value is a hard-coded placeholder, not a trained model. The value 10 is an action argument; the actual TP timeout is unverified.
- Sample line approximately 498 sends `TD ... Site 1 Abnormal Happen`; inspect and replace demo behavior before claiming anomaly detection.
- Actual flow found at `SmarTest/Case_Smt870/src/TestCase1/Main.flow`; inspect its prediction suites and referenced Java methods next.
- `rg` is unavailable on the remote host; use `grep`, `find`, and `sed`.
- User requested a complete remote Desktop ZIP for local development. Host identity was reverified as `group-6`; `/home/user/Desktop` and `/usr/bin/zip` exist. Archive creation is underway from `/home/user/Case_Event`, without exclusions.

`ONEAPI_Manual.pdf`, page 10: `consumeData` payload access must happen inside the callback; processing blocks subsequent callbacks. `consumeTPSend` receives a string; `consumeTPRequest(tc, request)` receives a JSON-format string and returns a string response. Verify challenge-specific fields in the test program.

The ActionManager table documents `set_message(testerid, reason)` and says `get(testerid)` is called at `consumeTPRequest`. Inspect the supplied helper/sample to preserve its exact get/clean behavior and avoid dropping pending messages.

Register the monitor before connecting. A zero `connect` return only means initiation; check communication state. Do not restart Nexus mid-SmarTest session.

## Immediate next actions and open facts

1. Read grp6 SDK request callbacks and the prediction test-program methods to establish exact request/response and timeout behavior.
2. Inspect training CSV headers and test flow to map all six permissible feature sets.
3. Open `/home/debugger/project` in grp6 code-server and verify the real streaming path.

Unspecified in the brief: submission deadline/format, presentation length, prediction tolerance, request payload schema, and timeout. The payload and timeout should be discovered from code first; contest logistics can be supplied by the user without blocking the read-only inspection.

## Browser and resume notes

### Local transfer check, September 19

- Remote archive creation completed: `/home/user/Desktop/Case_Event_grp6_20260919_100921.zip`, reported size 525M. Integrity test was not confirmed before interruption.
- Initial local check found only 14 files under `Case_Event/SmarTest` (launcher, descriptor, utility files/logs). `training/Data`, SDK `Edge/oneAPI_py3.10/bin/sample.py`, and `SmarTest/Case_Smt870/src/TestCase1/Main.flow` were missing.
- Local ZIP of the same name was only 21,245,952 bytes at first inspection, substantially smaller than the remote archive. Transfer/extraction is incomplete at this checkpoint; recheck before using as the complete dataset.

### Implementation progress, September 19

- Remote archive integrity verified with unzip -tq: No errors detected in compressed data.
- Archive content check verified Main.flow, Edge/oneAPI_py3.10/bin/sample.py, and all 25 training/Data/*_RawResult.csv files.
- Browser Devices double-click did not produce a visible local download; work continues from the verified remote source and local implementation.
- Added local grp6_app/: chronological CSV parser, target-stage feature allowlists, Ridge/NumPy fallback models, streaming z-score detector, replay report writer, and callback adapter with explicit unsupported / insufficient_data responses.
- Core smoke test passed on September 19, 2026. Full training and live deployment remain blocked until the complete dataset is available locally or copied through code-server.

Use the existing grp6 SSH session for inspection; the user left it in `Case_Event`. Individual `pressKey` characters work reliably through Guacamole. After actions, refresh accessibility state; use screenshots for terminal text because the remote surface is a canvas. Never reuse old grp1 handles.

Code-server was authenticated in remote Firefox, but the VNC tab is currently replaced by SSH. Reopen grp6 VNC through the dashboard when needed; do not assume the remote Firefox process stopped. User downloaded the PDF locally, so no further download is needed.

Historical prep and the previous handoff are retained in `HACKATHON_PREP.md` for reference only. This document supersedes their team selection, missing-challenge assumptions, speculative scope, and next-day resume instructions.

### Resumed remote inspection, September 19, approximately 11:37 VM time

- SSH input restored. Correct browser coordinate API is `tab.click([x,y])`; click terminal, close Guacamole menu with `ctrl+alt+shift`, then `typeText(command)` followed by `pressKey('Return')`. Take a later screenshot to allow the output to arrive. Hidden Guacamole textareas do not reliably execute commands.
- Fresh `hostname` returned `group-6`; SSH began in `/home/user`, then changed into `/home/user/Case_Event`.
- `/home/user/Case_Event/grp6_app_upload.zip` exists, 21,186 bytes. An `unzip -tq ... && sed ...` command reached the SDK read, confirming ZIP validation succeeded. Not extracted or deployed yet.
- Real CSV schema: row 0 header starts `PID,Lot,Wafer,Site,X,Y,PF,SBin,HBin,Test Time`; 3046 columns in first inspected CSV. Rows 1–4 are `Pin`, `Test Num`, `High Limit`, `Low Limit`. Device data starts at row 5. Example passing-looking row has PF=0, SBin=1, HBin=1; pass/fail semantics still need confirmation. Existing parser incorrectly treats Lot as site and metadata as data.
- Main.flow lines 429–468 verify execution: lot/wafer ID, Suite1–Suite14, IDDQ_flow, request1, sensor1, subflow1, request2, sensor2, subflow2, and so on through request6, sensor6, subflow6. Feature order must come from this flow and nested flows, never CSV ordering.
- `sample.py` imports `ActionManager` from compiled `libACSAction.so`; no Python helper found. Predict uses `set_wait(testerId,10,'prediction N: (site,value)...')`, then `get(testerId)`; action=list also uses get. It sends a fake anomaly every third touchdown; replace this demonstration behavior.
- `consumeData(tc,data)` dispatches via data type. TestStart uses `get_ResultCount`, `query_HeadSite`, `toSite`; this supplies active sites and increments touchdown count. TestEnd has `query_PartFlag`, `query_SBinResult`, `query_HBinResult`, `query_PartId`, coordinates and test time.
- Parametric result accessors verified: `query_TestNumber`, `query_TestSuite`, `query_TestText`, `query_Result`, `query_Unit`, `query_TestFlag`, `query_ParamFlag`, `query_ResultScaling`; multi-parametric uses `query_Results` and `query_PassFailList`. Pin naming/scaling must be confirmed before mapping to CSV feature names.
- WaferStart includes geometry; WaferEnd has `get_WaferId`, `get_TestedCount`, `get_GoodCount`. Need full lifecycle contract before final state routing.
- TP source `SmarTest/Case_Smt870/src/ACSTML/Predict.java`: default timeout=1 (unit still unverified), AppLoc=edge. It constructs JSON `key=predict,data=<integer>` and invokes RunPredict. Remaining response handling not read yet.
- Host `python3` is 3.6.8; python3.10 was not found on PATH. Current local app needs newer Python, so use Edge runtime or locate existing newer environment.
- VNC desktop currently shows Konsole. Relaunched supplied Firefox toward `http://advantestcell.local:29080`; need inspect resulting UI.
- Existing local implementation remains an unvalidated scaffold: missing actual ONEAPI callback integration and set_message, averages predictions over historical devices, silently drops full alert queue, guesses CSV schema/order, lacks wafer-grouped evaluation and full anomaly categories. Do not describe it as complete. No code edits or new tests yet in this segment.

Next: finish inspecting Predict.java RunPredict; open code-server; correct CSV parser and verified flow manifest; implement actual per-tester/touchdown/site callbacks and ActionManager alert delivery; upload revised code and validate on grp6. Current browser IDs at checkpoint: browser 1, SSH tab 8, VNC tab 9, dashboard tab 1; rediscover if reset.

### Checkpoint after code-server reopening, September 19

- User preference: ask the user to handle every upload/download. Prepare and verify archives, provide exact source/destination paths, and continue independent work while transfers happen.
- Code-server authenticated at http://advantestcell.local:29080/?folder=/home/debugger/project; project opened in Restricted Mode. Host Python is 3.6.8; Edge Python/runtime still needs inspection.
- Local parser, adapter, tests, README were revised. compileall and four directly invoked smoke functions passed; pytest unavailable. No VM deployment, live ONEAPI alert, or full-data validation has passed.
- Current adapter is provisional: missing SDK Monitor inheritance/registration, enum-based dispatch, packed HeadSite conversion, current-touchdown lifecycle, verified feature names, multi-result handling, and robust error evidence. Do not deploy either old upload ZIP as final.
- Parser now finds PID/Lot/Wafer/Site, skips metadata, and excludes sensor targets, but model fallback still incorrectly infers stage order from CSV. Must replace with verified nested-flow allowlists; add finite-value handling and lot isolation.
- Local grp6_app_upload_20260919_1145.zip is stale (8296 bytes). Only original remote grp6_app_upload.zip (21186 bytes) was located and tested for ZIP integrity; not deployed.
- Remote Python heredoc lost newlines through Guacamole typeText; source-review ZIP was not created. Cancel continuation with Ctrl+C, then use a single-line archive command. Browser currently has SSH tab 8 and VNC tab 9, browser 1.
- Predict.java builds key=predict,data=N; response uses SDK action collection, not arbitrary JSON. Sample requires one prediction prefix with all active site/value pairs, set_wait then get; anomaly delivery requires set_message.

### Checkpoint September 19: source transfer and trained models
- Verified grp6_sources_data.zip (12,571,563 bytes, 66 files), safely extracted to source_review. Contains 25 CSVs, SDK Python, Java and nested flows; keep original SDK binaries on VM.
- Six models trained on 2,000 devices / 3,036 measurements. Actual nested-flow allowlists contain 25/525/1025/1525/2025/2525 features. Ridge selects at most 32 within each training fold; five wafer-separated folds. MAEs: .003488/.026927/.020418/.024779/.063132/.027588 in CSV units. Physical units unverified. Targets use sensor1#CP, sensor2#DS0, sensor3#IO4, sensor4#IO1, sensor5#IO2, sensor6#IO3.
- New portable runtime.py, state.py, monitor.py and live_main.py implement SDK Monitor registration, enum dispatch, toSite conversion, current-touchdown isolation, full feature coverage, set_wait/get prediction responses, set_message alerts, JSONL evidence. New live code has NOT yet been tested or deployed. Old adapter.py is obsolete; do not deploy it.
- Wafer detector implements site imbalance, low yield, mean and spread changes; replay tuning and false-alarm analysis remain. Source DefineBins.java confirms SBin 1 PASS, 2-32 FAIL.
- Risks: ambiguous scalar pins, suite names/scaling in live measurements, callback latency, real tester round trips and alert receipt remain unproved. Step 1 live gate open, step 3 offline models done, steps 2/4/5 incomplete.
- User handles transfers. Prepare one corrected ZIP next. grp6 only. Browser SSH tab 8, VNC tab 9, browser 1; re-observe. Code-server /home/debugger/project. Avoid multiline Guacamole typing (newlines are stripped).

### Checkpoint September 19, deployment package ready
- Six trained models, production Monitor wrapper, anomaly detector and report implemented. compileall and all 13 local unittest tests pass. Selective runtime ZIP passes 8 tests under Python -S (no third-party packages); installer staging fixture passes and preserves original SDK. Live deployment is still unproved.
- Replay: all 25 wafers / 12,000 stage-restricted predictions. Expected anomaly category found on 6/7 labeled wafers; W25 spread decrease missed. W1 site imbalance at32; W3 low yield32; W9 low yield72; W14 mean up32; W18 mean down32; W23 spread up40. Additional categories retained. W2 measured yield53.75% contradicts normal label; valid low-yield alert retained.
- Normal check wafers 6/12/15/21/24 had zero alerts, but were inspected during tuning; not independent validation. Corrected report/calibration wording. Model accuracy remains five wafer-separated folds.
- Runtime/report shutdown waits for reporter and exports final HTML. Background report errors logged on next refresh. Runtime package excludes legacy modules and NumPy-dependent tests/training.
- grp6_deploy.zip: 308725 bytes; SHA256 ee2dae4a44f7deafc338b0898144871b0cf959d40c55647b769a80b94c30df6d. User asked to upload to /home/user/Case_Event. ZIP includes selective runtime, artifacts, 8 runtime tests, installer, runbook and replay evidence.
- Remote SSH hostname reverified group-6. sudo -n docker works; original supplied SDK binaries exist, no images/containers at previous inspection. App descriptor targets grp6/py-app:latest. Installer builds versioned image, tests, actual SDK constructor, then pushes version and latest when --push selected. No destructive tag.sh.
- Browser1 SSH8 VNC9; code-server /home/debugger/project opened; Terminal menu triggered folder trust prompt, accepted for requested project. Inspect resulting terminal next. Ctrl+Shift+P incorrectly opens Firefox private browsing; use menus. Single-line Guacamole input only.
- Next: receive ZIP, unzip into unique release path, installer --build --push with persistent log; inspect real Edge/code-server environment; run controlled tester rehearsal, verify all six current-feature responses and required set_message receipt. Save logs/image ID; run fallback in VM image. No live claims until observed.

### Checkpoint September 19, SDK protocol verified before deployment
- grp6 host reverified as group-6. Pulled base unifiedserver.local/all/template-data-app:v22.04, digest sha256:a1aa96279c37edab9665bad251f52eb1efcf7d6ca0fbad658230a1639c1720ca; Python3.10.12. Actual SDK imports and Monitor construction pass in the base container and code-server. No live Interface connection has been proved.
- Code-server is /home/debugger/project -> /data/project, dev-app-5446684885-qwzn5. Supplied SDK copied internally via SCP to /home/debugger/project/oneapi_sdk. This was host-to-Edge within grp6; user continues to handle local/remote transfer.
- Original bin/setup.cfg does not exist. Actual ActionManager works with ACTIONS_FILE_PATH pointing to a nonexistent file and creates no config. Removed incorrect installer prerequisite.
- Isolated real SDK smoke (no Interface.connect; fake tester grp6-smoke): set_wait and set_message both returned True. get returned only prediction wait action; get_prod returned the message in acs_prod_var, act_typ=msg. This proves serialization, NOT tester receipt.
- Adapter already used get_prod for prod_action; added production_action_response evidence. Treat explicit False from set_wait/set_message as failure. Corrected mock to maintain separate production and prediction queues. All13 local tests pass after changes.
- Latest grp6_deploy.zip: 310207 bytes, SHA256 710f533122c86dfb43c847196e906de5b3d0b2f7242db21b2be604445eb22243. Includes evidence auditor. Supersedes 310066-byte intermediate archive. Requested user upload to /home/user/Case_Event. Latest check found no grp6_deploy*.zip in Case_Event/Desktop/Downloads.
- EdgeLog utility reports host180.3.13.36 and Edge API3.4.0; no app containers listed. Do not mistake --help for a harmless usage switch: it runs log collection.
- Remaining: upload, build/push, copy app into code-server SDK workspace, real tester rehearsal with full coverage at all six stages and production alert receipt, preserve logs/image, VM replay. W25 spread decrease remains missed; no independent normal-wafer validation claim.

### Checkpoint September 19, 12:43 — built on grp6
- User uploaded corrected ZIP; remote size310207 and SHA256710f533122c86dfb43c847196e906de5b3d0b2f7242db21b2be604445eb22243 match. Extracted /home/user/Case_Event/grp6_release_1239.
- Installer --build --push succeeded, log grp6_deploy_1239.log. Image unifiedserver.local/grp6/py-app:20260919T044025Z; staging grp6_build_20260919T044025Z. Image ID sha256:ddd2671b55b89ada384be16eb93e4ad94842cd7038dfdbcac8dbb278a3d046b9. Registry digest sha256:f7c19251a2c7eb7c106c7d762e38ba03d590f3e06f722a0c419fc543d1003efd. Deployment record grp6_deployment_latest.json.
- All8 packaged runtime tests pass inside built image; real SDK Grp6Monitor constructed. Copied app internally to code-server oneapi_sdk/grp6_app; all8 tests pass there (log /home/debugger/project/grp6_tests.log).
- VM replay completed all25 wafers: expected6/7, W25 still missed, max scan109.08ms. Remote output grp6_replay, log grp6_vm_replay.log.
- Started supplied SmarTest/runTp.sh load in background, log grp6_tester_load.log. SmarTest launcher reported success but AppDeployer reports session not ready (12:42/12:43), investigating display/process/logs. No actual deployed running app or live callbacks proved yet. Do not confuse pushed image with running Edge deployment.
- Added TEAM_PROGRESS.md for teammate sharing, as requested.

### Checkpoint September 19 — first live run and teammate update
- Resumed-session findings: starting SmarTest with DISPLAY=:1 and XAUTHORITY=/home/user/.Xauthority resolved the missing GUI/session issue. AppDeployer start succeeded; Nexus showed SMT8 Ready and py-app running. Do not restart Nexus during the session.
- Real SDK event/command connections and communication enable were observed. Tester displayed the test-program acknowledgment. Engineering run1/1 completed, but TestEnd callback raised ValueError: query_PartFlag returned '0x0' and monitor.py line128 attempted decimal int parsing. Fix is pending.
- Detailed callback evidence currently lives in container /tmp/grp6_evidence.jsonl; add stdout mirroring or establish retrieval before the next run. Edge/EdgeLog/EdgeLog log retrieves application stdout.
- Live six-stage prediction coverage and tester prediction/alert receipt are still unverified. Next: fix PartFlag handling with regression coverage, make evidence retrievable, redeploy, repeat controlled engineering run and audit tester responses.
- Recreated concise TEAM_PROGRESS.md for sharing; records verified offline/VM results separately from incomplete live acceptance.

### Repository checkpoint September 19
- GitHub origin: Aquatictw/Hackathon_YJSNPI, main branch, HTTPS transport. Initial README pushed successfully; user requested tracking and pushing all project files.
- Added .gitignore for Python caches, local environments, Eclipse workspace metadata, and local credential files. Source, models, datasets, reports, documentation, archives, and analysis artifacts included.

### Local project review September 19 (no remote operations)
- Rechecked challenge text, current checkpoints, runtime/model code, packaging and saved replay evidence. The pending hexadecimal PartFlag parsing bug remains in monitor.py (`int(data.query_PartFlag(i))`). Live deployment status above is historical session evidence, not freshly verified remote state.
- Current local `python3 -m unittest discover -s grp6_app/tests -v`: eight runtime tests pass; test_core and test_guards cannot import because this Python 3.14 environment lacks NumPy. Do not describe the entire suite as currently passing locally.
- RTDI_LLM_ARCHITECTURE.md describes a separate proposed website/backend/LLM architecture and references HACKATHON_DELIVERY_PLAN.md, which is absent from the current file inventory. No implemented backend/web/agent service was found. Use CONTEST.md as the active plan and distinguish the existing grp6_app runtime from that proposal.
- Remaining priorities: repair PartFlag parsing and evidence retrieval; verify all six stage responses and anomaly receipt on grp6; investigate missed W25 spread decrease and W2 label/yield discrepancy; then complete presentation and optional interactive/LLM extensions.

### Browser SSH reconnect September 19 from Mac
- Rechecked dashboard rows grp6_acs_host_controller (180.3.13.36) and grp6_acs_edge_server (180.3.13.209), both Up. Opened grp6 shared View entry and reached authenticated browser SSH; visible prompt is `[user@group-6 ~]$`.
- Native Chrome input through Guacamole did not transmit the intended hostname command correctly (stale clipboard text / garbled characters). Shell returned to the home prompt; no successful directory change or fresh deployment inspection. Connection itself is established. Revalidate input before further commands.

### E frontend v0.1 local handoff September 19
- User requested a local-only frontend prototype while teammates work on C/D; asked to stop at a pushable milestone. Added frontend/ with isolated React/Vinext app, synthetic message scenarios, evidence charts, predictions, validated JSON reception/dedup, and clearly separated demo/OpenAI chat modes.
- Read user-supplied /Users/alan/Downloads/message.txt as reference data. Added limited v1 events-envelope adapter; keep frontend 0.1-draft view model distinct from D's final wire contract. No remote actions or deployment performed for this frontend work.
- Eleven frontend tests, tsc and build pass. Local HTTP tests confirm demo reply and 503 missing-key behavior; browser receive/evidence/demo-chat flow verified. No OpenAI key exists in inspected process config, so real model calls untested. No machine commands implemented, no AI-to-receipt status promotion.
- Local preview http://localhost:5173 retained. frontend/HANDOFF.md records exact C/D boundaries, setup, completed verification and limitations. User handles commit/push; unrelated results/local_replay/ was already present during this task and not included in the suggested staging scope.
