# grp6 RTDI test assistant

**Competition in progress — September 19, 2026.** This is the authoritative competition plan, working record, and deployment runbook. Read it before remote work; update verified findings, edits, validation, unresolved issues, and exact next steps here before context compaction. It consolidates the former contest, preparation, progress, application, deployment, and workspace-instruction Markdown files.

The app detects semiconductor test anomalies, produces an HTML evidence report, and returns six stage-specific temperature predictions through ACS Gemini / ONEAPI. **The newest recorded engineering run has full coverage at all six stages on four sites; all six tester prediction actions passed for that run. Live timeout recovery and production anomaly-message acceptance remain open.**

## Resume here

1. Reconnect to **grp6 only** and verify the named dashboard rows and hostname `group-6`. Retrieve the latest channel-fix deployment identity and remote `grp6_channel_audit.json`; do not rebuild an already deployed fix solely because an older checkpoint says upload pending.
2. Preserve channel-fix image 20260919T052422Z, retrieve its image ID/digest, and retain grp6_channel_evidence.jsonl, grp6_channel_audit.json, and tester datalog grp6_channel_tester.edl. Its newest recorded run has full six-stage/four-site coverage; verify that evidence against the actual running image.
3. Repeat a controlled engineering run and exercise delayed measurement/timeout behavior. The successful run did not enter the wait branch, so it does not validate live recovery from the earlier stage 1/5 coverage gaps.
4. Run simulated production with the app ready before lot start. Correlate a real detected anomaly, `set_message`, `prod_action` response, and actual tester display. Save JSONL, HTML, stdout, tester logs/screenshots, and image/model identities.
5. Keep replay ready; investigate W25's missed spread decrease without hard-coding wafer labels. Complete the final demo rehearsal.

Prioritize real Gemini operation, correct timing, tester feedback, and a queryable report. Reduce model/UI complexity before sacrificing integration. Submission deadline/format, presentation duration, prediction tolerance, physical temperature units, and effective TP timeout remain unconfirmed. Old time-box estimates were not a contest deadline.

## Latest verified status and acceptance

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

- [x] Flow-derived feature manifest, six trained models, grouped validation, replay and report.
- [x] grp6 image build/push, real SDK construction, live event delivery, corrected TestEnd processing.
- [x] Channel-fix image passes 12 runtime tests and one live six-stage/four-site coverage audit, per the newer recorded checkpoint.
- [ ] Channel-wait fix passes live delayed-measurement recovery and effective timeout checks.
- [x] One engineering run: all six stages/four active sites have full selected-feature coverage and tester action execution receipts; accuracy and production robustness remain unproved.
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

`RTDI_LLM_ARCHITECTURE.md` was not edited by this consolidation. Concurrent updates to that file were preserved, including the newer channel-run checkpoint summarized above. It describes an independent proposed implementation; its old status sections and links to removed notes do not override this record. Its referenced HACKATHON_DELIVERY_PLAN.md is absent. Former CONTEST.md, TEAM_PROGRESS.md, HACKATHON_PREP.md, AGENTS.md, grp6_app/README.md, deploy/RUNBOOK.md, FRONTEND_HANDOFF.md, frontend/README.md, frontend/HANDOFF.md, and frontend/contracts/README.md content now lives here; old handoff/prep pointers also refer to this consolidated record.

Available role evidence supports A (machine integration/deployment), with substantial B contributions (data/models/detection), using architecture §13.1 roles. A's full live acceptance remains open and B has the W25 gap. A local E frontend prototype now exists alongside the HTML report. External backend/transport, multi-step LLM agent, and live dashboard integration remain pending. Align with teammates before treating the architecture and grp6_app as one implementation. External services must not block local predictions, basic alerts, or core rehearsal.

References: `Question_20260919.pdf` (requirements/scoring), `WorkShop_Material.pdf` (transfer p11, development/deployment pp19–26, data/anomalies pp28–29), `ONEAPI_Manual.pdf` (Monitor, NexusData, ActionManager, lifecycle), `py-app.dockerfile`, `requirements.txt`. Extracted texts are in tmp/pdfs. Supplied py-app.log is reference output only, never evidence of our live run.

## Frontend prototype and integration

The merged E prototype in frontend/ is local-only: React/Vinext/TypeScript dashboard, six-stage prediction/actual table, evidence charts, JSON validation/deduplication, synthetic normal/anomaly/missing/duplicate scenarios, and separated demo/OpenAI chat modes. It does not read competition CSVs, change machine behavior, send commands, or establish live integration. Models/detectors remain on Edge; exporter/backend integration is pending.

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

Preview defaults to http://localhost:5173. Browser state keeps at most 100 recent batches and clears on refresh, not durable storage/deduplication. Teammate checkpoint: 11 contract tests, TypeScript and build passed; browser receive → evidence → demo-answer and explicit missing-key 503 checked. Config exposes no key. Optional WebMCP receive_rtdi_demo_batch loads synthetic examples only; one valid anomaly call was tested, not complete WebMCP acceptance. Real OpenAI and live frontend acceptance remain unverified.

The implemented local proxy uses frontend/.dev.vars copied from .dev.vars.example, with server-only OPENAI_API_KEY / OPENAI_MODEL; restart and refresh after configuring. Process environment also works; .env.example is a Node-backend migration reference. Never place keys in frontend code, messages, or NEXT_PUBLIC_/VITE_ variables. /api/config returns configuration status only. /api/assistant explicitly separates rule-based demo mode from model mode, keeps histories separate, and never silently substitutes demo answers after errors. Model mode uses a fixed Responses endpoint, store:false, 30-second timeout, selected event/evidence/incident/predictions, and latest 10 event/mode-specific chat messages. No machine tools or multi-step investigation implemented. This describes repository code, not production acceptance.

Same-origin checks, input bounds, and per-process rate limits are local safeguards, not public auth. D owns user/team scope, durable rate/cost controls, formal AI tools and commands/ACKs. Confirm permitted export before sending competition data. AI text never establishes tester receipt.

### Team boundaries and files

| Owner | Integration responsibility |
| --- | --- |
| A / B | Actual SDK transport, predictions, verified units/scope and tester receipts. |
| C | Actual anomaly evidence/incident fixtures: kind/direction, sites, baseline/current, counts, sequence/time, units, series and method version. |
| D | Final v1 schema; durable ingest/snapshot/SSE, auth, LLM tools, commands/results and validated receipts. |
| E | Adapt D's event stream and C's evidence into UI; prototype milestone complete, further features await integration. |

frontend/app/page.tsx is UI; lib/rtdi/contracts.ts validates/deduplicates; lib/rtdi/edge-adapter.ts adapts v1; app/api/assistant/route.ts is a thin proxy D can port without adopting this framework. frontend/contracts/schemas.json defines Draft 2020-12 event/prediction/evidence/incident/command/command_ack/batch schemas. Normal/anomaly/missing/duplicate fixtures are synthetic; duplicate reuses anomaly IDs. Sample a.u./demo °C units do not establish SDK units; observed example means equal series means. Third-party notice frontend/vendor/shadcn-tailwind-4.13.0.LICENSE.md is retained separately.

### View model and proposed backend contract

The supplied message.txt was an architecture example, not a final API. 0.1-draft is an internal UI view model, not an Edge requirement. The limited adapter accepts {schema_version:1,edge_id,batch_id,events} with measurement, prediction, prediction_actual, evidence, heartbeat, run_summary; maps site_id/source_mode/timestamp/prediction/current_value. Try frontend/contracts/examples/edge-v1-batch.json. Unknown lot/wafer/unit stays unknown; no series means no chart; absent coverage/ACK never implies complete delivery. Multi-site evidence stays descriptive pending site-level summaries.

prediction_actual requires event_id/timestamp/run_id/tester_id/request_id and one uniquely matching prior prediction (site_id/device_id recommended); request_id alone cannot join across runs. UI IDs must be globally unique and same-ID/different-content is rejected. Backend scoped keys need unique UI conversion. Preserve run/tester and applicable lot/wafer/site; never merge across scopes. View-model timestamps are timezone-qualified ISO 8601.

Local-only input (browser memory, not HTTPS ingestion):

~~~js
window.dispatchEvent(new CustomEvent('rtdi:batch', {detail: batch}));
~~~

D must finalize these proposed, unimplemented routes:

| Route | Draft behavior |
| --- | --- |
| POST /api/v1/events/batch | Up to 100 records / 256 KiB; scoped bearer auth; validate whole batch, durably store before 200. Dedup (run_id,tester_id,record_id), batch_id retry key; identical duplicate allowed, changed content 409. accepted/duplicates draft counts mean records. |
| GET /api/v1/edge/commands?edge_id=...&after=... | Auth binds tester/run; return commands, next_cursor, poll_after_ms (example 3000). Edge dedups command_id, checks run/tester/expiry and saves state before execution; reject expired/wrong-scope/unsupported commands. |
| POST /api/v1/commands/{command_id}/result | Persist/dedup ack_id before 200. edge_received → edge_executed → tester_confirmed are distinct; failed/expired retain reasons. confirmed requires independently verified tester_receipt_id plus command linkage, not just a valid string. |

400/422 isolate bad outbox data; 401/403 fix auth before retry; 409 resolve ID conflict; 413 split batch; 429/5xx/network errors honor Retry-After or exponential backoff+jitter, retaining IDs/outbox. message.txt instead uses accepted ID arrays and queued/fetched/applied/confirmed; D must settle differences. Prefer accepted/duplicates/rejected ID arrays for precise outbox clearance. fetched=Edge received, applied=executed, confirmed=verified receipt. set_message success, AI text, and unverified ACK fixtures never establish confirmation.

Still needed: base URL, token issuance, exact limits/errors/backoff, polling cursor, ACK endpoint and website aggregation (suggested run_id/mode/last_event_at/data_quality/device_count/yield/incidents/predictions/commands). Unknown values stay unknown. Test HTTPS POST from actual deployed container; if blocked jointly choose HC relay or internal backend. Frontend changed no machine network and supplies no production DB/ingest/SSE/auth/command path.

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

### Exporter gaps

The current logs do not yet have uniform event IDs, run IDs, sequence numbers, or a schema version. Prediction records also omit explicit lot/wafer/touchdown IDs. Only the first 12 mapped measurements per app process are individually logged: the evidence log is **not a complete raw-measurement feed**.

The backend/Edge exporter needs to attach scope at collection time, preserve IDs across retries, store events, and expose a snapshot plus updates. This is the recommended envelope, **proposed and not implemented**:

~~~ts
interface DashboardEnvelope<T> {
  schema_version: '1';
  event_id: string;                    // stable across retries
  run_id: string;
  sequence: number;
  mode: 'live' | 'replay';
  received_at: string;                 // ISO 8601
  event_time: string | null;           // null when source has none
  scope: {
    tester_id: string | null;
    lot_id: string | null;
    wafer_id: string | null;
    touchdown: number | null;
  };
  payload: T;                         // existing event payload
}
~~~

No deployed HTTP URL, SSE/WebSocket endpoint, ACK protocol, or user-to-tester command API exists in our current app. Agree those with the backend teammate; do not assume route names. LLM chat and user-triggered tester commands are separate planned capabilities.
