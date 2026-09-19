# grp6 RTDI test assistant

**Competition in progress — September 19, 2026.** This is the authoritative competition plan, working record, and deployment runbook. Read it before remote work; update verified findings, edits, validation, unresolved issues, and exact next steps here before context compaction. It consolidates the former contest, preparation, progress, application, deployment, and workspace-instruction Markdown files.

The app detects semiconductor test anomalies, produces an HTML evidence report, and returns six stage-specific temperature predictions through ACS Gemini / ONEAPI. **The newest recorded engineering run has full coverage at all six stages on four sites; all six tester prediction actions passed for that run. Live timeout recovery and production anomaly-message acceptance remain open.**

## Resume here

Checkpoint (September 19, 14:38 Taipei): uploaded core bundle verified on `group-6`: 331,948 bytes, SHA256 `c49930d9a7ecb55ad4a77a38a705c58095406be234572c21558bc4e8d07d762c`. Image `unifiedserver.local/grp6/py-app:20260919T062939Z` built/pushed, **21 packaged VM tests** and real SDK Monitor construction passed. AppDeployer stop/start succeeded without restarting Nexus; ONEAPI communication enabled. One engineering touchdown passed all six stages/four sites, 24 prediction_actual records, zero audit errors, 0.419–1.741 ms callback latency. Tester EDL records six actions, each Exec Pass 1 / Fail 0. Decoded B13456 / 02 matches tester ASCII datalog. JSONL SHA256 `274c1892e177dc6834bfd6931b8924c560e53fb9a5f367766434591fbedb4da3`. HTML generated from that file. Remote files: `grp6_core_eng_{evidence.jsonl,audit.json,report.html,tester.edl,tester.txt}`, `grp6_core_eng_edge.log`, `grp6_core_build.log`. Old deployment record saved as `grp6_deployment_before_core.json`; SmarTest workspace backed up and tar-verified as `grp6_before_prod_workspace.tgz`. Production launcher started at 14:36:39; at checkpoint it was completing its supplied cleanup/sleep. Production acceptance is still pending; inspect `grp6_core_prod.log` and live Edge logs next.

Production checkpoint (September 19, 14:53 Taipei): the first production launcher recreated the tester session and removed the Edge deployment while AppDeployer retained stale state. Stop/start recovered the app mid-lot; that 80-device run (74 pass / 6 fail) is incomplete integration evidence. Stage 5/6 measurement coverage sometimes stayed near 0.59/0.56 after the 200 ms wait, so predictions were correctly withheld. EdgeLog output also omitted early events under native DEBUG verbosity. Preserved `grp6_core_prod_partial*`, `grp6_core_prod_edge2.log`, and `/tmp/STDF` copy `grp6_core_prod_partial_stdf/`. Changed documented `ONEAPI_DEBUG` from 6 to 1, preserving `grp6_descriptor_debug6.json`; no model/runtime change. App stop/start succeeded and communication was enabled at 06:47:13 UTC (`grp6_core_prod2_{start,ready}.log`). Rerunning the supplied recipe through the already-bound TCCT session to avoid another session teardown. Full production, actual joins, anomaly receipts and durable export remain unchecked.

Production checkpoint (September 19, 15:15 Taipei): run 3 completed 80 devices (74 pass / 6 fail), 120 prediction requests and 480 actual records. Five-second EdgeLog snapshots retain the complete production process, sequence 1–765. A pre-lot startup-only record from 07:03:13 UTC is preserved in `grp6_core_prod3_capture_all.jsonl`; the production process starts at 07:04:19 UTC. Normalized JSONL keeps that process only. HTML reconstruction joins 480/480 actuals with no errors. Three real alerts at device 32 (site imbalance, mean up, mean down) were queued and returned together by `get_prod`; matching tester alert receipt is still unverified. Current EDL preserves prediction action execution but the searched alert IDs were not found. Do not mark display confirmed.

Run 2 captured only 317 unique events because collection began late and is not a full-lot acceptance run. `EdgeLog` returns partial logs, so end-only retrieval is insufficient. Run 3 snapshots, STDF and raw capture are preserved remotely. Engineering archive downloaded locally, ZIP integrity passed, JSONL SHA matches `274c1892e177dc6834bfd6931b8924c560e53fb9a5f367766434591fbedb4da3`; local audit confirms continuous sequence and zero errors.

- [x] Local evidence/report/metadata/audit regression suite: 31 tests pass (`results/core_evidence_tests.log`).
- [x] Full production process recorded remotely: 80 devices, 120 requests, 480 actuals, continuous sequence 1–765.
- [x] Production HTML generated from exact JSONL: 480 actual joins, no report errors.
- [x] Downloaded production ZIP passes CRC; local audit confirms 765 events, 80 devices, 120 complete requests and 480 actuals.
- [x] All 120 prediction responses match exact tester action JSON and successful adjacent execution, each receipt used once (`results/vm_production/tester_receipt_audit.json`).
- [ ] Tester receipt/display of the three anomaly messages remains unverified.
- [x] Uploaded core revision passes 21 packaged tests and real SDK construction on grp6; engineering run has 24 actual records and six tester action receipts.
- [x] Engineering metadata B13456 / 02 independently matches tester ASCII output; source JSONL and generated HTML preserved remotely.
- [ ] Same new revision passes real SDK/image tests and engineering/production on grp6.
- [x] Engineering encoded metadata matches tester output; report joins all 24 prediction actuals.
- [x] Production HTML and exact source JSONL downloaded into `results/vm_production/`; full archive preserved as `grp6_production_evidence.zip`.
- [ ] Production anomaly tester receipt confirmed.

1. Keep deployed image `20260919T062939Z` and model SHA unchanged while preserving production evidence. Do not rerun or rebuild merely to reproduce existing proof.
2. Production archive is downloaded and audited. Share the exact JSONL/report; remaining tester work is anomaly receipt, not repeating the 120 confirmed prediction responses.
3. Remote commits `0816050`, `6024dd7` and `0d85915` are integrated: optional exporter, versioned packaging and D backend. Preserve core metadata/UUID/actual joins. Exporter enablement still needs a focused VM/backend smoke test.
4. Keep remaining timing/units/lifecycle/W25 gates open until separately proven.

Prioritize real Gemini operation, correct timing, tester feedback, and a queryable report. Reduce model/UI complexity before sacrificing integration. Submission deadline/format, presentation duration, prediction tolerance, physical temperature units, and effective TP timeout remain unconfirmed. Old time-box estimates were not a contest deadline.

## Latest verified status and acceptance

### Local merge verification — September 19, 2026

Cleanup: removed superseded exploratory Python probes and rendered PDF page/contact-sheet images from `tmp/`. Original PDFs, useful extracted reference text, source/training data, models, deployment packages and run evidence are preserved.

- [x] Core suite: **37 tests pass**, including shared raw/exported run/request/prediction/device identity, exporter queue failure isolation, and disabled-exporter measurement overhead checks (`results/merged_core_tests.log`).
- [x] Frontend/backend suite: **23 tests pass** (`results/merged_frontend_tests.log`). These tests do not prove a production build or deployed backend.
- [x] Production JSONL SHA256: `dcd2fda6e8b09dd9fb51f9c713098c756abd1d24caece813a709af6bcd8fa4af`. Local audit confirms a complete single-process capture, zero malformed/error events, and six complete stages. Maximum recorded callback latency: 8.350 ms.
- [x] Prediction execution: 120/120 exact JSON matches with adjacent Exec Pass 1 / Fail 0 in matching tester EDL text. Three anomaly messages returned by get_prod still lack tester receipt proof.

The merge preserves model artifacts and existing evidence; retraining and repeating the original production run are unnecessary for merging source. The deployed grp6 image remains `20260919T062939Z`. The merged optional exporter has **not** been deployed or validated on the VM. Before enabling it, verify backend deployment/migration, gzip ingestion, identity and delivery acknowledgments from the actual container. Raw JSONL retains numeric schema version/ISO time; the optional exporter retains the string version/Unix time envelope accepted by D's adapter, with shared run/device/request identities.

Exporter limitations: memory-queued events are not durable until SQLite commit; nested payloads are shallow-copied; any HTTP 2xx is currently treated as whole-batch success without per-event acknowledgment. Nonfinite payload handling and measurement completeness semantics need hardening before live enablement. W25 detection, physical units, live timeout recovery and cross-wafer lifecycle acceptance remain open. This is a verified source merge, not 100% end-to-end acceptance.

These are recorded September 19 findings, not a fresh remote check. Local and VM test counts refer to different package versions.

| Area | Evidence and remaining limit |
| --- | --- |
| Data/models | 25 CSVs, 2,000 devices, 3,036 measurements; six Ridge models and mean baselines validated with five wafer-separated folds. Per-wafer/site revalidation reproduces aggregate metrics. |
| Detection/report | All 25 wafers replayed; 12,000 stage-restricted predictions; expected anomaly category detected on 6/7 labeled wafers. W25 spread decrease missed. HTML evidence report implemented. |
| Deployment | Image built/pushed on grp6; 8 packaged runtime tests and actual SDK Monitor construction passed in the original image and code-server. Hex-flag image also passed 8 VM tests and was deployed. |
| Live run | Nexus showed SMT8 Ready and `py-app` running; ONEAPI event/command connections, communication enable, and TP acknowledgment observed. Four-site engineering run completed. |
| Callback evidence | Remote `grp6_livefix_edge.log`: 12,183 callbacks, 12,124 mapped measurements, 12 intentionally unmapped lot/wafer metadata values, no callback errors, four TestEnd records with raw flag `0x0`. |
| Prediction coverage | Stages 2/3/4/6 had full coverage and prediction actions returned. Tester Message Center displayed stages 4/6; stage 6 action execution pass=1/fail=0. Stage 1: 24/25 features (0.96). Stage 5: 31/32 selected features (0.96875; 2,009 total values). Missing-data predictions safely withheld. |
| Channel fix | Condition-based wait releases callback lock for up to 200 ms, rejects touchdown/site/wafer lifecycle changes, and logs missing features/wait status. 17 local tests passed. The latest recorded checkpoint records 12 runtime tests passing in the grp6 image and one four-site run with full six-stage coverage, no callback audit errors, and 0.57–1.05 ms latency (`grp6_channel_audit.json`, remote). Tester datalog grp6_channel_tester.edl records all six prediction actions with Exec Pass: 1 / Exec Fail: 0 each. This proves action handling for that run, not prediction accuracy or production robustness. The wait branch was not exercised; live delayed-data/timeout recovery remains unverified. |
| D local backend | 23 Node behavior tests pass. The gzip exporter adapter normalizes alerts and chunks original payloads into a 10-table D1 schema; migration integrity passes. Snapshot/SSE, read-only LLM tools and guarded command/results routes exist locally. TypeScript build, deployed D1 route, OpenAI inference and grp6 container-to-backend delivery remain unverified. |

- [x] Flow-derived feature manifest, six trained models, grouped validation, replay and report.
- [x] grp6 image build/push, real SDK construction, live event delivery, corrected TestEnd processing.
- [x] Channel-fix image passes 12 runtime tests and one live six-stage/four-site coverage audit, per the newer recorded checkpoint.
- [ ] Channel-wait fix passes live delayed-measurement recovery and effective timeout checks.
- [x] One engineering run: all six stages/four active sites have full selected-feature coverage and tester action execution receipts; accuracy and production robustness remain unproved.
- [x] Local D adapter accepts bounded grp6 gzip envelopes in behavior tests and preserves original events in D1-safe chunks; no live network/deployment claim.
- [ ] Real anomaly reaches tester via `set_message` and production action retrieval, with correlated receipt evidence.
- [ ] Units/scaling, missing/unknown-request behavior, retest/multi-head/reconnect lifecycle verified live.
- [ ] W25 cause resolved and reproducibly evaluated; independent normal-wafer false-alarm assessment remains outstanding.
- [ ] Full production rehearsal and saved image/model/log/report evidence.

## Workspace rules and remote environment

- **Team is grp6**, explicitly confirmed September 19. Use only `grp6_acs_host_controller` and `grp6_acs_edge_server`; never operate grp1 or use its prior results as grp6 readiness evidence. Verify identity before commands.
- User prefers hands-on work and remote code-server development. **User handles every local/remote upload and download**: prepare/verify archives and provide exact paths. Host-to-Edge internal copying has been used within grp6.
- Continue authorized SSH/VNC integration work; preserve originals and user changes. User requested evidence-backed acceptance tracking and git pushes after substantial verified changes. Origin: `Aquatictw/Hackathon_YJSNPI`, branch `main`, HTTPS transport.
- Keep credentials, tokens, SSH keys, and API keys out of notes, source, publicly shared logs, and presentations. Ignore rules cover caches, environments, Eclipse metadata, and local credential files.
- Register the monitor before connecting; zero `Interface.connect` return proves initiation only. Check communication state and actual events. **Do not restart Nexus during a SmarTest session.**

| Resource | Verified location / note |
| --- | --- |
| Dashboard | `https://sandbox.gemini.te-cloud.advantest.com/dashboard/virtual-machine` |
| Host row | `grp6_acs_host_controller`, `180.3.13.36`; hostname `group-6` |
| Edge row | `grp6_acs_edge_server`, `180.3.13.209`; recheck named rows on reconnect |
| Host package | `/home/user/Case_Event`; contains Edge, SmarTest, training, doc, firefox_128, images |
| Host SDK | `/home/user/Case_Event/Edge/oneAPI_py3.10/bin`; preserve native libraries and wrappers |
| Code-server | `http://advantestcell.local:29080/?folder=/home/debugger/project`; project symlink resolves to `/data/project` |
| Edge development SSH | `debugger@advantestcell.local:29022`; SDK at `/home/debugger/project/oneapi_sdk`, app under `oneapi_sdk/grp6_app` |
| Runtime | Host Python 3.6.8; supplied base container/code-server Python 3.10.12. Installer supports 3.6+; run the app in Edge/container. |
| Base image | `unifiedserver.local/all/template-data-app:v22.04`; digest `sha256:a1aa96279c37edab9665bad251f52eb1efcf7d6ca0fbad658230a1639c1720ca` |
| Container layout | SDK bin copied to `/opt/nexus/OneAPI/bin`; starts `python3 -u main.py`; supplied Dockerfile sets `ONEAPI_DEBUG=6` |
| Descriptor | Image `grp6/py-app:latest`, container `py-app`; registry prefix `unifiedserver.local` |

Browser recovery: rediscover tabs/IDs rather than reusing old handles. grp6 gateway is `tevmip-180-3-13-67-endtevmip`. Guacamole/VNC is a canvas: use fresh screenshots for terminal/UI output and current tool documentation for controls. Focus the terminal; close the Guacamole menu with Ctrl+Alt+Shift if needed. `typeText` has failed silently or stripped newlines; use single-line commands and individual key presses when necessary (Space for spaces). Refresh screenshots after execution; long commands can leave stale rendering. Cancel a stuck heredoc with Ctrl+C. Use code-server menus: Ctrl+Shift+P opened Firefox private browsing. Reopen grp6 VNC through the dashboard if SSH replaced its tab. Remote host lacks `rg`; use grep/find/sed there.

## Challenge, scoring, and results

Source: `Question_20260919.pdf`, all seven pages including wafer table and flowchart. Build an intelligent assistant for semiconductor test data in ACS RTDI/Gemini:

1. Detect anomalies during simulated production and provide an organized report people can query or receive. Page 6 requires `ActionManager.set_message(tc.testerId, message)` back to the tester. A local queryable report supports the query option.
2. When TP sends target number 1–6, predict the corresponding IC temperature and return it at the correct stage.

The brief describes both scenarios without explicitly saying both are mandatory; current scope covers both. Completion is **60%** (scenario fit 10%, successful Gemini operation 25%, correct detection/prediction timing 25%). Innovation is **40%** (analysis method 15%, anomaly report presentation 25%). External website/LLM services are proposed extensions, not stated prerequisites.

| Request | Target in brief / CSV sensor pin | Latest eligible flow boundary | Allowlisted features | Five-fold MAE* |
| --- | --- | --- | ---: | ---: |
| 1 | `100_Main.sensor1_CP` / `sensor1#CP` | Suite1–Suite14 and IDDQ_flow, before sensor1 | 25 | 0.003488 |
| 2 | `120_Main.sensor2_DS0` / `sensor2#DS0` | Through subflow1, before sensor2 | 525 | 0.026927 |
| 3 | `140_Main.sensor3_IO4` / `sensor3#IO4` | Through subflow2, before sensor3 | 1,025 | 0.020418 |
| 4 | `160_Main.sensor4_IO1` / `sensor4#IO1` | Through subflow3, before sensor4 | 1,525 | 0.024779 |
| 5 | `180_Main.sensor5_IO2` / `sensor5#IO2` | Through subflow4, before sensor5 | 2,025 | 0.063132 |
| 6 | `200_Main.sensor6_IO3` / `sensor6#IO3` | Through subflow5, before sensor6 | 2,525 | 0.027588 |

*CSV numeric units; physical temperature units unverified. Actual nested execution order comes from `SmarTest/Case_Smt870/src/TestCase1/Main.flow` and referenced flows, not numeric test IDs or CSV column order. Sequence: request1 → sensor1 → subflow1 → request2 → … → request6 → sensor6 → subflow6. Current models exclude all sensor targets. Final bins, pass/fail, total test time, and wafer labels are never prediction inputs.

| Wafer label | Replay: first expected-category alert at completed device |
| --- | --- |
| W1 — site imbalance | 32 |
| W3 / W9 — yield below 80% | 32 / 72 |
| W14 / W18 — mean trend up / down | 32 / 32 |
| W23 / W25 — standard deviation trend up / down | 40 / missed |
| Other wafers among W1–W25 — labeled normal | W2 actually measures 53.75% yield; retain its valid low-yield alert |

Labels agree with `training/TrainDataInfo.txt`; they identify training/evaluation examples and must never become live lookup rules. Additional alert categories are retained. Check wafers 6/12/15/21/24 had zero alerts, but were inspected during tuning and are **not independent validation**. Abnormal wafers were development examples; precise anomaly onset is unknown. VM replay's measured max scan was 109.08 ms, not a live request-latency guarantee.

## Data, models, and application contract

Verified source transfer: `grp6_sources_data.zip`, 12,571,563 bytes / 66 files, extracted to `source_review`; contains all 25 CSVs, SDK Python, Java, and nested flows. Native SDK binaries remain on VM. An older full archive `/home/user/Desktop/Case_Event_grp6_20260919_100921.zip` (~525 MB) passed remote `unzip -tq`, but its initial local copy was truncated; do not substitute that partial extraction for source_review.

CSV row 0 starts `PID,Lot,Wafer,Site,X,Y,PF,SBin,HBin,Test Time` (3,046 columns). Rows 1–4 are Pin, Test Num, High Limit, Low Limit; devices start at row 5. Measurements use `<test number>_<test suite name>#<pin name>`. `DefineBins.java` confirms SBin 1 = PASS, 2–32 = FAIL. Preserve raw flags: live `query_PartFlag` returns strings such as `0x0`; decimal int parsing caused the fixed TestEnd failure.

Ridge selects at most 32 features inside each training fold; imputation/scaling/selection must remain training-only. Five folds separate wafers (wafer number modulo 5). Use out-of-fold MAE/RMSE, baseline comparisons, and per-wafer/site errors in validation artifacts; replay uses fitted training devices and is not independent accuracy measurement.

Detectors combine per-test normal thresholds and agreement across related suites for site imbalance, mean/spread changes, and low yield. Low yield uses completed devices, SBin=1, below 80%, minimum 32 devices, and a one-sided 95% Wilson upper bound before wafer end. Group/suppress duplicate alerts and distinguish insufficient evidence from normal. W25 diagnostics found temporal family gates below threshold and no qualifying family under a conservative per-test normal-minimum ×0.7 spread screen; no detector thresholds or production model artifacts were changed by that diagnosis.

Production entrypoint: `grp6_app.live_main.main()`. `monitor.py` registers the SDK Monitor, dispatches enums, converts packed HeadSite with `toSite`, and isolates tester/lot/wafer/touchdown/site state. Keep supplied SDK modules intact. `adapter.py` and old train/replay modules are legacy experiments excluded from deployment.

Callback rules and verified SDK details:

- Inspect `data.getType()` before event-specific getters. Copy values inside `consumeData`; native payloads are invalid after return. Update current-device features promptly; background queues must not make predictions stale. Keep report/network/heavy work outside the callback, bound queues, and expose overflow/missing events.
- Handle lot/wafer/test start/end and cleanup. Keys must distinguish tester, lot/wafer, device/touchdown, site/head, and retest attempt as available; never average historical devices or unrelated sites into a response. Keep persistent baselines separate from current-device state.
- TestStart uses `get_ResultCount`, `query_HeadSite`, `toSite`. TestEnd exposes part flag/ID, bins, coordinates, test time. WaferEnd exposes `get_WaferId`, `get_TestedCount`, `get_GoodCount`. Device/pin definitions provide mapping/bin context.
- Parametric getters: `query_TestNumber`, `query_TestSuite`, `query_TestText`, `query_Result`, `query_Unit`, `query_TestFlag`, `query_ParamFlag`, `query_ResultScaling`; multi-parametric uses `query_Results`, `query_PassFailList`. Preserve identity/pin mapping and finite-value checks; do not guess scaling. First live samples log units/scaling.
- `consumeTPSend` receives a string; `consumeTPRequest(tc, request)` receives/returns strings. `Predict.java` constructs JSON `key=predict,data=N`, AppLoc=edge, default timeout=1; timeout unit/effective deadline remains unverified.
- Predict reply: one `prediction N:` prefix with all active `(site,value)` pairs; call `ActionManager.set_wait(tc.testerId, 10, message)` then `get(tc.testerId)`. Argument 10 is not a verified TP timeout. Never use the sample's hard-coded 25.22 prediction or every-third-touchdown fake alert as real results.
- ActionManager comes from `libACSAction.so`. `set_message` queues anomalies; `prod_action` retrieves them with `get_prod`, while `get` retrieves prediction actions. Isolated real-SDK smoke confirmed `get_prod` emits `acs_prod_var`, `act_typ=msg`; this proves serialization only. Preserve separate queues and exact retrieval/clean lifecycle. Explicit False from setters is failure.
- Missing `bin/setup.cfg` is valid: actual SDK worked with `ACTIONS_FILE_PATH` pointing to a nonexistent file. Do not restore the removed installer prerequisite.
- Unknown stage, missing features, model errors, or timeout must not fabricate numeric predictions or invent unsupported TP error schemas. Verify failure handling with the receiver. Queued, provided, and tester-confirmed are separate states.

## Local commands and evidence

Run from repository root. Runtime/replay use Python standard library; training requires NumPy. Native ONEAPI execution belongs in the supplied Python 3.10 environment.

~~~powershell
python -m unittest discover -s grp6_app/tests -v
python -m grp6_app.rehearse source_review/training/Data --output results/replay
python deploy/package_grp6.py
~~~

The packager writes `grp6_deploy.zip`, verifies CRC and per-file SHA256, includes this README at archive root, and excludes legacy/NumPy-dependent runtime code. Repackaging changes hashes: record fresh values before upload. Existing ZIPs are versioned evidence, not automatically synchronized to working-tree edits.

For intentional model rebuilding (overwrites default artifacts), followed by detector calibration:

~~~powershell
python -m grp6_app.build_models source_review
python -m grp6_app.calibrate
~~~

| File / directory | Purpose |
| --- | --- |
| `grp6_app/{state,runtime,monitor,live_main}.py` | State, portable inference/detection, SDK adapter, production entrypoint |
| `grp6_app/{data,rehearse,report}.py` | CSV parsing, deterministic replay, HTML report |
| `grp6_app/artifacts/{manifest,runtime,validation}.json` | Flow allowlists, deployed models/calibration, five-fold model/baseline metrics |
| `results/model_revalidation/validation.json` | Six stages × 25 wafers × four sites out-of-fold metrics and fold membership; log at `results/model_revalidation.log` |
| `results/replay/{summary.json,report.html,replay.jsonl,acceptance_audit.json}` | Replay evidence and limitations; never live acceptance |
| `results/fix_tests.log`, `results/channel_fix_tests.log` | 14-test flag-fix checkpoint and 17-test channel-wait checkpoint |
| `results/{spread_diagnosis,baseline_spread_diagnosis,across_site_spread_diagnosis}.json` | W25 read-only diagnostics; diagnostic scripts/logs alongside application/results |
| `deploy/install_grp6.py`, `deploy/audit_evidence.py` | Identity/checksum-checked installer; callback evidence auditor |

## Deployment and rehearsal runbook

### Recorded package and image identities

| Artifact | Identity and state |
| --- | --- |
| Channel-fix package | `grp6_channel_fix.zip`: 311,583 bytes; SHA256 `21c52ec6bd795414b61da86c8c49ba78f1e0cbab8a7466100bb7c69c13ffb270`. User reported upload to `/home/user/Case_Event`; latest uploaded image is unifiedserver.local/grp6/py-app:20260919T052422Z, with runtime/live coverage and tester-action execution success. Retrieve its image digest and deployment record before further changes; final acceptance remains open. |
| Original deployed bundle | `grp6_deploy.zip`: 310,207 bytes; SHA256 `710f533122c86dfb43c847196e906de5b3d0b2f7242db21b2be604445eb22243`; verified remote, extracted to `/home/user/Case_Event/grp6_release_1239`. This identifies that historical bundle, not necessarily today's local ZIP. |
| Original image | `unifiedserver.local/grp6/py-app:20260919T044025Z`; image ID `sha256:ddd2671b55b89ada384be16eb93e4ad94842cd7038dfdbcac8dbb278a3d046b9`; registry digest `sha256:f7c19251a2c7eb7c106c7d762e38ba03d590f3e06f722a0c419fc543d1003efd`. |
| Verified live hex-flag image | `unifiedserver.local/grp6/py-app:livefix-20260919` and latest; digest `sha256:81cd96f70948955b3010ba454e06ea43db68fc816278368607b5e77f787c4057`. Built from `grp6_build_livefix`; four-site evidence above. |

Older `grp6_app_upload*.zip` scaffolds are stale; do not deploy them. The latest tag can move: identify each run by recorded version/digest.

### Install/build

Have the user upload the selected verified archive to `/home/user/Case_Event`. On the verified grp6 host, compare hash/size and extract to a **new, unused release directory** (replace example name per run):

~~~bash
hostname
cd /home/user/Case_Event
sha256sum grp6_channel_fix.zip
stat -c %s grp6_channel_fix.zip
unzip -tq grp6_channel_fix.zip
unzip -q grp6_channel_fix.zip -d grp6_release_channel_01
python3 grp6_release_channel_01/install_grp6.py --build --push > grp6_deploy_channel_01.log 2>&1
cat grp6_deployment_latest.json
~~~

Stop if identity/hash/size differs. For a newly generated `grp6_deploy.zip`, substitute that filename and fresh checksum. The installer verifies every bundled checksum, requires group-6, copies supplied SDK into timestamped staging, changes only staging main.py, builds a versioned image, runs packaged tests, constructs the real SDK Monitor, and pushes version plus latest when requested. It preserves originals/old images and avoids the destructive supplied tag.sh. Save build success, deployment JSON and registry digest; a push alone does not prove Edge is running the app.

Remote records under `/home/user/Case_Event`: `grp6_deploy_1239.log`, `grp6_build_20260919T044025Z`, `grp6_deployment_latest.json`, `grp6_livefix_build.log`, `grp6_livefix_tests.log`, `grp6_livefix_edge.log`, `grp6_vm_replay.log`, `grp6_replay`, `grp6_tester_load.log`. Edge development test log: `/home/debugger/project/grp6_tests.log`.

### Start and inspect

`runTp.sh` copies the descriptor every invocation. load/prod_run use startSmt.py, which rebuilds workspace and restarts SmarTest/TCCT; coordinate the intended run with teammates. Engineering mode can stream ONEAPI events. prod_run is full simulation and does not honor a second loop argument as a one-run guarantee.

If SmarTest needs loading, the verified GUI/session fix was:

~~~bash
cd /home/user/Case_Event/SmarTest
DISPLAY=:1 XAUTHORITY=/home/user/.Xauthority bash runTp.sh load
~~~

Wait for SMT8 Ready. If already loaded, start the app and run one controlled engineering touchdown:

~~~bash
/opt/acs/nexus/bin/AppDeployer start
cd /home/user/Case_Event/SmarTest
bash runTp.sh eng_run 1
~~~

For production, use `bash runTp.sh prod_run` from that directory and verify app readiness before lot start. Do not restart Nexus. AppDeployer previously reported session-not-ready until the DISPLAY/XAUTHORITY fix; launcher success alone was insufficient.

Live evidence defaults to `/tmp/grp6_evidence.jsonl` and `/tmp/grp6_evidence.html`; set `GRP6_EVIDENCE` to a verified writable persistent volume if available. JSONL is mirrored to stdout with `GRP6_EVIDENCE` prefix. `Edge/EdgeLog/EdgeLog log` collects stdout; **its --help switch also runs collection**, so do not assume it is inert. Reports refresh asynchronously every 32 devices and at boundaries; shutdown waits for final HTML export and background report errors are logged on the next refresh. Preserve files before container removal; user handles downloads.

~~~bash
python3 -m grp6_app.report /tmp/grp6_evidence.jsonl --output report.html
python3 audit_evidence.py /tmp/grp6_evidence.jsonl --output acceptance_audit.json
~~~

Run auditor from an extracted bundle (repository equivalent: `python deploy/audit_evidence.py PATH --output OUTPUT`). It consumes plain JSONL, not stdout with the prefix. Require stages 1–6 with status=response_queued, coverage=1.0 and predictions for all active sites, no callback/request/action/report errors, and matching lifecycle/measurement events. Separately inspect tester GDR logs / Message Center / MessUI for predictions and real anomaly messages. The recorded_callback_gate does not prove tester receipt or VM provenance.

### Replay fallback and demo

Bundled `results/replay/report.html` is self-contained **replay** evidence. To regenerate on VM, create `/home/user/Case_Event/grp6_replay`, replace IMAGE with the versioned image in deployment JSON, and run:

~~~bash
sudo -n docker run --rm --entrypoint python3 -v /home/user/Case_Event/training/Data:/data:ro -v /home/user/Case_Event/grp6_replay:/out IMAGE -m grp6_app.rehearse /data --output /out
~~~

Replay needs no SDK connection or NumPy. Present connection/data freshness and live/replay identity, site/wafer overview, six-stage coverage/latency and later actual values, incident timeline, affected tests/pins, baseline comparisons, yield, and tester delivery status. Each incident should say what/where/when, sample count, evidence, severity, and suggested next check; distinguish observations from possible causes. Preserve exports and demonstrate the query/filter path. Core pitch: explainable early test anomalies and stage-valid predictions from shared real-time data, with evidence returned to engineers and the tester.

## Architecture and team coordination

`RTDI_LLM_ARCHITECTURE.md` now adopts the existing grp6_app implementation and separates verified engineering evidence, pending production acceptance, and optional external services. Former FRONTEND_HANDOFF.md and deployment notes are consolidated here. The untracked grp6_FRONTEND_HANDOFF.md is a separate teammate copy; it does not override the implementation contract below.

Available role evidence supports A (machine integration/deployment), with substantial B contributions (prediction/models) and C contributions (detection/report), using architecture §13.1 roles. A's full live acceptance remains open and C has the W25 gap. A local E frontend prototype now exists alongside the HTML report. D's durable ingest, snapshot/SSE, bounded multi-step LLM investigation, guarded command/result APIs, and a compatibility adapter for the merged gzip Edge exporter exist in the current local working tree but are not deployed. Per-measurement/prediction projection and live dashboard integration remain pending. External services must not block local predictions, basic alerts, or core rehearsal.

References: `Question_20260919.pdf` (requirements/scoring), `WorkShop_Material.pdf` (transfer p11, development/deployment pp19–26, data/anomalies pp28–29), `ONEAPI_Manual.pdf` (Monitor, NexusData, ActionManager, lifecycle), `py-app.dockerfile`, `requirements.txt`. Extracted texts are in tmp/pdfs. Supplied py-app.log is reference output only, never evidence of our live run.

## Frontend prototype and integration

The merged E prototype in frontend/ is local-only: React/Vinext/TypeScript dashboard, six-stage prediction/actual table, evidence charts, JSON validation/deduplication, synthetic normal/anomaly/missing/duplicate scenarios, and separated demo/OpenAI chat modes. D has added local backend routes and persistence code, but E still reads browser memory and has not switched to the snapshot/SSE APIs. It does not read competition CSVs or establish live integration. Models/detectors remain on Edge; exporter/backend integration is pending.

### Setup and recorded verification

Node >=22.18 is required (teammate used 24.15); dependencies are locked. From repository root:

~~~bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
# Verification:
npm test
npx tsc --noEmit
npm run build
~~~

Preview defaults to http://localhost:5173. Browser state keeps at most 100 recent batches and clears on refresh, not durable storage/deduplication. The original E checkpoint had 11 contract tests plus successful TypeScript/build checks. After D's additions, 23 Node behavior tests pass, including deterministic conversion of all 14 replay alerts, bounded gzip decoding, grp6 exporter normalization, D1-safe raw payload chunking, SSE cursor framing, command confirmation/receipt guards, evidence citation validation and bounded tool calls. The current machine cannot reinstall the complete npm dependency set from its restricted network, so D's additions still require a fresh `tsc`, Vinext build and route integration test in a complete environment. Real OpenAI and live frontend acceptance remain unverified.

The implemented local proxy uses frontend/.dev.vars copied from .dev.vars.example, with server-only OPENAI_API_KEY / OPENAI_MODEL, INGEST_TOKEN and a separate COMMAND_TOKEN; restart and refresh after configuring. Process environment also works. Never place keys or tokens in frontend code, messages, or NEXT_PUBLIC_/VITE_ variables. /api/config returns configuration status only. /api/assistant explicitly separates rule-based demo mode from model mode and never silently substitutes demo answers after errors. Persisted run chat uses a bounded Responses function-calling loop with read-only `get_run_summary`, `get_incident_evidence`, and `compare_sites` tools, at most six tool calls and a 20-second deadline. Answers may cite only evidence IDs returned by those tools. No AI tool can create a machine command. This describes local repository code, not production acceptance.

Same-origin checks, input bounds, and per-process rate limits are local safeguards, not public auth. D owns user/team scope, durable rate/cost controls, formal AI tools and commands/ACKs. Confirm permitted export before sending competition data. AI text never establishes tester receipt.

### Team boundaries and files

| Owner | Integration responsibility |
| --- | --- |
| A / B | Actual SDK transport, predictions, verified units/scope and tester receipts. |
| C | Actual anomaly evidence/incident fixtures: kind/direction, sites, baseline/current, counts, sequence/time, units, series and method version. |
| D | Final v1 schema; durable ingest/snapshot/SSE, auth, LLM tools, commands/results and validated receipts. |
| E | Adapt D's event stream and C's evidence into UI; prototype milestone complete, further features await integration. |

frontend/app/page.tsx is UI; lib/rtdi/contracts.ts validates/deduplicates the UI model; lib/rtdi/edge-adapter.ts adapts v1. D's formal wire validation is `frontend/lib/rtdi/wire.ts`, its JSON Schema is `frontend/contracts/edge-v1.schema.json`, and API routes live under `frontend/app/api/v1`. frontend/contracts/schemas.json remains the UI's Draft 2020-12 model. Normal/anomaly/missing/duplicate fixtures are synthetic; duplicate reuses anomaly IDs. Sample a.u./demo °C units do not establish SDK units; observed example means equal series means. Third-party notice frontend/vendor/shadcn-tailwind-4.13.0.LICENSE.md is retained separately.

### View model and proposed backend contract

The supplied message.txt was an architecture example, not a final API. 0.1-draft is an internal UI view model, not an Edge requirement. The limited adapter accepts {schema_version:1,edge_id,batch_id,events} with measurement, prediction, prediction_actual, evidence, heartbeat, run_summary; maps site_id/source_mode/timestamp/prediction/current_value. Try frontend/contracts/examples/edge-v1-batch.json. Unknown lot/wafer/unit stays unknown; no series means no chart; absent coverage/ACK never implies complete delivery. Multi-site evidence stays descriptive pending site-level summaries.

prediction_actual requires event_id/timestamp/run_id/tester_id/request_id and one uniquely matching prior prediction (site_id/device_id recommended); request_id alone cannot join across runs. UI IDs must be globally unique and same-ID/different-content is rejected. Backend scoped keys need unique UI conversion. Preserve run/tester and applicable lot/wafer/site; never merge across scopes. View-model timestamps are timezone-qualified ISO 8601.

Local-only input (browser memory, not HTTPS ingestion):

~~~js
window.dispatchEvent(new CustomEvent('rtdi:batch', {detail: batch}));
~~~

D's current local implementation exposes these routes; none is deployed or proven reachable from grp6 Edge:

| Route | Current local behavior |
| --- | --- |
| POST /api/v1/events/batch | `INGEST_TOKEN`; accepts formal Edge v1 records up to 256 KiB, plus the merged grp6 exporter envelope as bounded gzip (4 MiB compressed / 8 MiB decompressed). Exporter alerts normalize to evidence/incidents; original exporter events are saved in D1-safe chunks. Whole-batch validation, scoped event/batch idempotency and accepted/duplicates/rejected ID arrays remain in force. |
| GET /api/v1/runs/{run_id} | Snapshot containing run provenance, events, evidence, incidents and commands; ambiguous tester scope returns 409. |
| GET /api/v1/runs/{run_id}/events | Resumable SSE with D1 row cursor, Last-Event-ID, `ready`, `edge_event`, heartbeat and bounded reconnect cycles. |
| GET /api/v1/incidents/{incident_id} | Incident plus evidence constrained to one run/tester scope. |
| POST /api/v1/runs/{run_id}/chat | Persisted, read-only multi-step investigation; stores answer, evidence IDs and tool trace. |
| POST /api/v1/runs/{run_id}/commands | Same-origin explicit `user_confirmed:true`; only `show_message`, live runs and 30–300 second TTL. Stable request ID is idempotent. |
| GET /api/v1/commands/pending | Separate `COMMAND_TOKEN`; returns unexpired queued commands for a tester/run. |
| POST /api/v1/commands/{command_id}/results | Separate `COMMAND_TOKEN`; idempotent ack ID and forward-only status. `tester_confirmed` requires a receipt ID. |

400/422 isolate bad outbox data; 401/403 fix auth before retry; 409 resolve ID conflict; 413 split batch; 429/5xx/network errors honor Retry-After or exponential backoff+jitter, retaining IDs/outbox. message.txt instead uses accepted ID arrays and queued/fetched/applied/confirmed; D must settle differences. Prefer accepted/duplicates/rejected ID arrays for precise outbox clearance. fetched=Edge received, applied=executed, confirmed=verified receipt. set_message success, AI text, and unverified ACK fixtures never establish confirmation.

`npm run replay:edge -- --run-id <id> --started-at <ISO time>` converts `results/replay/replay.jsonl` into deterministic formal Edge v1 evidence batches. Without `--endpoint` it validates only and performs no network request; all 14 current replay alerts pass.

Still needed: deployable build, base URL, token issuance/rotation, user authentication, E snapshot/SSE consumption, and a query/display contract for raw `DeviceCompletedBundle` measurements and per-site prediction maps. Unknown values stay unknown. Test HTTPS POST from the actual deployed container only after deployment; if blocked jointly choose an approved host-controller relay or internal backend.

## Existing Edge payloads and exporter integration

Consume results/replay/summary.json for the board, results/replay/replay.jsonl for replay alerts, and remote /home/user/Case_Event/grp6_channel_evidence.jsonl for real callback fixtures. JSONL is one object per nonempty line; strip GRP6_EVIDENCE when extracting stdout. Advantest ONEAPI is the supplied tester bridge; the Edge entrypoint is not an HTTP server or LLM agent. Suggestions are deterministic.

### Actual data types

These describe the existing emitted data, not a deployed web endpoint. Extra diagnostic fields may also be present.

~~~ts
type AlertKind =
  | 'site_imbalance' | 'low_yield'
  | 'mean_drift_up' | 'mean_drift_down'
  | 'spread_up' | 'spread_down';

interface AlertEvidence {
  kind: AlertKind;
  message: string;
  test: string;                       // full measurement identity
  site: string;                       // '1', '2', ... or 'all'
  completed_devices: number;          // detection position, not timestamp
  observed: number;
  reference: number;
  score: number;                      // detector score, NOT probability
  series: number[];
  site_series: Record<string, number[]>;
  baseline: {
    mean: number; sd: number;
    thresholds?: Record<string, number>;
  } | null;                           // null for low-yield alerts
  suggestion: string;
  family?: string;
  family_score_over_threshold?: number;
  family_persistence_scans?: number;
}

interface LiveAlertEvent {
  time: number; kind: 'alert'; tester: string;
  lot: string; wafer: string; alert: AlertEvidence;
}
interface ReplayAlertEvent {
  kind: 'alert'; mode: 'replay';
  lot: string; wafer: number; alert: AlertEvidence;
}
interface PredictionEvent {
  time: number; kind: 'prediction_request'; tester: string;
  stage: 1 | 2 | 3 | 4 | 5 | 6;
  status: 'response_queued' | 'insufficient_current_data';
  predictions: Record<string, number>; // site -> prediction
  coverage: Record<string, number>;    // 0..1 of selected model inputs
  feature_counts: Record<string, number>;
  missing_features: Record<string, string[]>;
  waited_for_measurements: boolean;
  lifecycle_changed: boolean;
  latency_ms: number;
  response: string;                    // SDK action string; diagnostics
}
interface QueuedMessageEvent {
  time: number; kind: 'action_message'; tester: string;
  message: string; api_return: string; status: 'queued_unconfirmed';
}
interface ProductionActionEvent {
  time: number; kind: 'production_action_response'; tester: string;
  response: string; status: 'returned_to_callback_unconfirmed';
}
interface Metrics {
  n: number; mae: number; rmse: number;
  worst_error: number; baseline_mae: number;
}
interface ReplaySummary {
  mode: 'replay'; live_integration: string;
  wafers: Array<{
    wafer: number; devices: number; yield: number; // yield is 0..1
    expected: string;                            // evaluation label only
    expected_first_device: number | null;
    alerts: AlertEvidence[];
  }>;
  expected_anomalies_detected: number;
  expected_anomaly_wafers: number;
  max_scan_ms: number; max_model_ms: number;
  prediction_in_sample_mae: Record<string, number>;
  validation: {metrics: Record<string, Metrics>};
  limitations: string[];
}
~~~


### Display semantics

- **Predictions:** show stage, site, value, coverage, latency, and delivery state. Coverage 1 means all selected inputs are present; it does not mean 100% accuracy. Empty predictions mean insufficient data, not zero temperature.
- **Accuracy:** use validation.metrics for held-out MAE/RMSE. prediction_in_sample_mae is fitted-data replay error and must not be presented as independent validation.
- **Alert plots:** site_series maps each site to values in completed-device order within that site. Plot array index on the x-axis; these are not timestamps. Alerts contain selected evidence, not all 3,036 measurement columns or a spatial wafer map.
- **Low yield:** series is cumulative yield; observed and reference are fractions, with reference 0.8. Display them as percentages.
- **Units:** physical temperature units are unverified. Display “CSV units” or “unit unverified”; do not assume °C.
- **Time:** live time is Unix seconds, so use new Date(event.time * 1000). Replay alerts currently lack timestamps.
- **Identity:** site IDs are strings. Replay wafer IDs are numbers and live wafer IDs are strings; normalize wafer IDs to strings. Live unknown IDs may be empty.
- **Source status:** replay events explicitly say mode=replay; raw live events omit mode. The backend must attach provenance. Missing mode does not prove live freshness.
- **Errors:** request_error, callback_error, action_error and report_error are separate records. Show failure/insufficient-data states instead of treating missing data as normal.

### Evidence and external wire contract

Core image `20260919T062939Z` adds numeric schema_version=1, UUID event/run/request/device IDs, sequence, ISO timestamp, source_mode=live, lot/wafer/touchdown scope, model SHA, final prediction actual/error records and run summaries. These changes pass 26 local tests and 21 packaged VM tests; engineering produced 24 actual records and six successful tester action receipts. Production acceptance remains open. The first 12 mapped measurements are sampled: JSONL is not a complete raw feed. Repeated predictions retain separate IDs; raw device identity is test UUID + site, with PartID recorded separately. Multi-head site collisions fail closed.

Raw JSONL uses kind/tester/lot/wafer/time and multisite prediction maps. It is not directly the frontend wire format. The v1 UI adapter accepts numeric schema_version=1 (not the old string '1' nested payload proposal):

~~~ts
interface EdgeBatch {
  schema_version: 1;
  edge_id: string;
  batch_id: string;
  events: Array<{
    event_id: string;
    type: 'measurement' | 'prediction' | 'prediction_actual' | 'evidence' | 'heartbeat' | 'run_summary';
    tester_id: string;
    timestamp: string; // timezone-qualified ISO 8601
    run_id?: string;
    lot_id?: string; wafer_id?: string;
    site_id?: number; device_id?: string;
    source_mode?: 'live' | 'replay' | 'simulation';
    [field: string]: unknown;
  }>;
}
~~~

Frontend/lib/rtdi/edge-adapter.ts defines accepted per-type fields. Split each raw prediction request into per-site events; preserve device/run/tester scope for actual joins. The adapter currently uses request_id as its prediction ID, so an exporter must use the unique per-site prediction_id as that wire request_id and retain the original request identity separately. Unknown units/scopes remain unknown. The adapter does not yet display raw alert series, coverage or tester receipt state; the standalone HTML report retains these details.

No deployed HTTP ingestion URL, SSE/WebSocket endpoint, delivery ACK protocol, or user-to-tester command API is implemented by the core. LLM chat and user-triggered commands remain separate backend/frontend work.

Encoded production metadata: Main.lotidTest tests 20/21 carry lower/upper ASCII chunks; Main.waferidTest test 25 carries the wafer string. New runtime isolates detector windows on decoded scope changes even in final-test mode without WaferStart. A touchdown containing mixed scopes is rejected rather than aggregated. Raw test flags are sampled for audit; their validity bits and physical scaling still need SDK/runtime confirmation.
### Edge outbound HTTPS exporter

`grp6_app/exporter.py` implements an optional stdlib-only outbound exporter. When
`GRP6_EXPORT_URL` is unset, existing Gemini behavior is unchanged. When configured,
ONEAPI callbacks enqueue copied lifecycle, prediction, alert, and per-site
`DeviceCompletedBundle` events without network I/O. A background worker first stores
events in a SQLite outbox, then sends gzip-compressed JSON batches over TLS with retry
and stable event IDs. A full device contains about 3,036 measurements, so D must accept
gzip and set an appropriate decompressed request limit; the default batch size is one.

~~~text
GRP6_EXPORT_URL=https://backend.example/api/v1/events/batch
GRP6_EXPORT_TOKEN=<server-issued bearer token>
GRP6_EXPORT_OUTBOX=/tmp/grp6_export.sqlite3
GRP6_EDGE_ID=grp6-edge
GRP6_EXPORT_QUEUE=32
GRP6_EXPORT_BATCH=1
GRP6_EXPORT_TIMEOUT=5
~~~

Each request has `{schema_version, edge_id, batch_id, events}`. Device events include
run/lot/wafer/tester scope, monotonic process-local sequence, touchdown, part/device ID,
site/head/raw HeadSite, SDK timestamp, X/Y, test time, SBin/HBin/part flag/pass state,
all canonical measurements and data-quality counts. Measurement entries include test
number, suite, pin, raw value, unit/scaling, limits/scaling, and test/param flags.
`attempt` is deliberately null with `attempt_status=unverified_sdk_field` until a real
retest contract is verified. SDK getters and live unit/scaling values still require a
grp6 run; code availability is not live acceptance.

At lot start the exporter also emits a `detector_baseline_artifact` containing the exact
runtime SHA256, all 3,035 detector baselines, per-test thresholds, family thresholds,
baseline wafers, calibration settings, and explicit score semantics. The historical
`mean` field was calculated with `nanmedian`; the event labels that fact as
`baseline_location_semantics=median_stored_in_legacy_mean_field` without changing the
runtime format. Per-test training sample count, missing rate, build timestamp, and live
units are not present in the current artifact and are reported as gaps rather than
invented values.

The receiver must support `Content-Encoding: gzip`, deduplicate by `event_id`, return a
2xx only after durable storage, and tolerate retries. Public plaintext HTTP is rejected;
HTTP is accepted only for localhost tests. The exporter belongs inside the Edge
`py-app` container. SSH/VNC are administration paths, not data destinations. If the
deployed container cannot reach the public HTTPS endpoint, use an approved host-controller
relay rather than performing HTTP inside ONEAPI callbacks.

**Local D adapter status:** `/api/v1/events/batch` now accepts this gzip exporter
envelope with a 4 MiB compressed and 8 MiB decompressed bound. It converts string
schema version, Unix timestamps, `mode` and `event_type` into the formal run/event
identity. Alerts become normal evidence/incidents. Every original exporter event is
also retained losslessly as base64 chunks of at most 500,000 raw bytes across
`raw_events` and `raw_event_chunks`; this avoids D1's 2 MB single-row/string limit.
Lifecycle, baseline, prediction-request and device bundles currently surface as compact
`run_summary` events while their complete payload remains in raw storage. Therefore
ingestion compatibility is implemented locally, but per-measurement queries and E's
per-site prediction display are not yet connected. Do not enable the exporter until
the route is built, deployed, migrated and tested from the actual grp6 container.

Remaining coordination before live enablement:

- deployed HTTPS `POST /api/v1/events/batch` URL and completed D1 migration;
- server-issued bearer-token delivery/rotation method (never commit the token);
- one container-to-backend gzip smoke test using a real device bundle near the size limit;
- exporter handling of accepted/duplicate/rejected ID arrays and 409 identity conflicts;
- raw-event retention/redaction policy and backend observability contact;
- confirmation that exporting the competition fields is permitted, plus required redaction;
- C/D/E agreement on per-site prediction and raw measurement query/display fields, including unknown unit/retest semantics.
