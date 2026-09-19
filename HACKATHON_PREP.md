> Historical reference, archived September 19, 2026. Read [CONTEST.md](CONTEST.md) for the active contest plan, verified grp6 state, and next actions. Old grp1 observations and instructions below are superseded. The challenge PDF and remote training data are now available.
# Hackathon Prep for ACS RTDI and ONEAPI

## Team to use — confirmed 2026-09-19

**Our team is grp6. Use grp6 virtual machines only.** The user corrected the previous grp1 assumption. Dashboard: `grp6_acs_host_controller` at `180.3.13.36`; `grp6_acs_edge_server` at `180.3.13.209` (recheck on reconnect). Prior grp1 access, package discovery, and test results below are historical and do not establish grp6 readiness. Verify grp6 code-server and streaming from scratch. See the correction at the top of SESSION_HANDOFF.md.

## Latest session status — 2026-09-18

Read [SESSION_HANDOFF.md](SESSION_HANDOFF.md) first when resuming. The engineer package has now been found in the remote group-1 environment (it is still absent from this local folder). The Python sample was started and one engineering run completed with four passing sites, soft/hard bin 1. No test-result callbacks were observed in the running Python terminal. A SmarTest license warning was observed, but its relationship to the missing events is unproven. Production simulation and image deployment have NOT been performed.

## Bottom line

The materials point toward a real-time semiconductor-test application built on ACS Nexus and ONEAPI. Nexus streams production lifecycle events and test results into a Python callback. Your best hackathon path is a small, reliable application that turns those events into an immediately understandable decision: detect site imbalance, drift, variance changes, or sudden measurement shifts, then show the affected test, pin, site, and device.

The current folder is reference material, not a runnable project. It does not contain the required `bin` directory and ONEAPI library, `main.py`, `sample.py`, `tag.sh`, `runTp.sh`, test program, app descriptor, or sample CSV shown in the workshop deck. Obtain the full engineer package before coding.

## What the system does

ACS RTDI moves data and decisions between SmarTest on the host controller, ACS Nexus, and an application running on the Edge server or ACS Unified Server. ACS Gemini is the virtual environment used to develop and test the application before production deployment.

The runtime sequence is:

1. SmarTest produces lot, wafer, device, flow, suite, measurement, and test-result events.
2. Nexus forwards each event to the ONEAPI application.
3. ONEAPI invokes the application's `consumeData` callback.
4. The application copies the required values, performs or schedules analysis, and returns.
5. Optional control actions can be sent back through Nexus.
6. For production simulation, the application is packaged as a Docker image, pushed to AUS, pulled by the Edge server, and started before the simulated run.

## The most important programming rules

- Call `data.getType()` before using any event-specific getter.
- Read and copy every value you need while inside `consumeData`; the event data is cleared after the callback.
- Keep `consumeData` fast. It blocks the event thread and cannot receive another event until it returns.
- Put copied payloads on a queue and do feature engineering, model inference, file I/O, plotting, and network calls in a worker thread or process.
- `Interface.connect(...) == 0` means the connection request started, not necessarily that the Nexus command channel is already established. Check the connection state before sending control commands.
- Register the monitor before connecting.
- Ensure the application is running before production begins or the beginning of the lot can be lost.
- Do not restart Nexus during a SmarTest session; the documentation warns that Edge containers may not be cleaned up correctly.

Conceptual callback shape:

```python
def consumeData(self, test_cell, data):
    event_type = data.getType()
    payload = copy_event_values(event_type, test_cell, data)
    event_queue.put_nowait(payload)
    # Return immediately; analyze payload in a worker.
```

## Events worth implementing first

Start with the smallest event set that supports a coherent demo:

| Event | Why it matters |
|---|---|
| `PRODUCTION_LOTSTART` | Capture lot, product, tester, test type, site list, and setup metadata. |
| `DEVICE` and `DEVICE_PIN` | Capture test program, bin definitions, and pin mapping. |
| `PRODUCTION_TESTSTART` | Establish the current touchdown and active sites. |
| `MEASURED_PARAMETRIC` | One measured value per site; easiest path to a first anomaly detector. |
| `MEASURED_MULTI_PARAM` | Multiple pin values per site; needed for the richer dataset shown in the workshop. |
| `PRODUCTION_TESTEND` | Capture device/part ID, coordinates, test time, and soft/hard bins. |
| `PRODUCTION_LOTEND` | Flush output, calculate the run summary, and close the demo cleanly. |

Add `MEASURED_FUNCTIONAL`, scan, suite, flow, and measurement events only after the basic pipeline is stable.

## Data model

Use a long-form event table internally. A practical measurement key is:

```text
lot_id + part_id + head/site + test_number + test_suite + measurement_name + pin_name
```

Store at least:

- timestamp
- lot and device identifiers
- head/site
- X/Y coordinates when available
- test number, suite, measurement, and pin
- low and high limits
- value and pass/fail flag
- soft bin and hard bin at test end

For exported wide data, the workshop's naming convention is:

```text
<test number>_<test suite name>#<pin name>
```

## Recommended project

### Real Time Test Cell Guardian

Build a live anomaly monitor that identifies:

- site-to-site imbalance
- upward or downward drift
- standard-deviation growth or collapse
- sudden mean shifts
- limit-margin risk before an outright test failure

For each alert, display the test number, test suite, pin, affected site, current value, expected range, anomaly reason, and confidence/severity. A simple robust baseline is enough: rolling median and median absolute deviation, per-site deltas, and a short-window trend slope. This is easier to explain and debug than a complex model, while directly matching the anomaly patterns in the workshop.

Stretch goal: add a recommended action through `ActionManager`, but keep real control disabled during the demo unless the organizers explicitly authorize it. Show the proposed action first. The API can bypass tests or patterns, change a test-program variable, request a wait, show a message, clean actions, and retrieve actions.

## Tomorrow's build order

### First 45 minutes

- Confirm Gemini and development-VM access without copying credentials into code, chat, Git, or slides.
- Locate the full engineer package and verify the missing files listed in the preflight section below.
- Run the untouched sample with `python3 main.py`.
- Verify that the log reaches lot start, measurement events, test end, and lot end.

### Next 75 minutes

- Reduce the sample to the seven core events listed above.
- Copy event values into plain Python dictionaries.
- Add a bounded queue and background worker.
- Write a tidy CSV or JSONL record per measurement.

### Middle of the hackathon

- Implement one detector end to end before adding more detectors.
- Start with site-to-site imbalance because it is highly visual and needs little historical data.
- Add trend and variance detection only after the first alert is trustworthy.
- Create a one-screen demo: live values, site comparison, alert list, and lot summary.

### Final 90 minutes

- Build and push the Docker image.
- Start the application before the production simulation.
- Run one clean rehearsal and preserve its logs and screenshots.
- Prepare a fallback prerecorded or static replay using the known-good log if the live environment is unstable.
- Freeze features. Fix only demo blockers.

## Commands shown in the workshop

Run the application in the development environment:

```bash
python3 main.py
```

Load the test program, then run it once in engineering mode:

```bash
./runTp.sh load
./runTp.sh eng_run 1
```

Build and push the application image:

```bash
sudo ./tag.sh
```

Run the production simulation:

```bash
./runTp.sh prod_run
```

These scripts are referenced by the workshop but are not present in this folder.

## Docker and dependency notes

The supplied Dockerfile:

- uses `unifiedserver.local/all/template-data-app:v22.04`
- copies `bin/.` into `/opt/nexus/OneAPI/bin`
- sets `ONEAPI_DEBUG=6`, which enables debug logging to both console and file
- starts `python3 -u main.py`

The build cannot succeed from this folder because `bin/` is absent. The internal base-image and registry hostnames are also expected to work only inside the event environment.

The supplied requirements include Flask, matplotlib, NumPy, pandas, Paramiko, Pillow, Requests, scikit-learn, jsonschema, and a pinned pytz version. Keep the first working image small and do not import heavy libraries inside the callback unless needed. `jsonschema` is the only dependency explicitly required by the ONEAPI SDK documentation.

## What the sample log proves

The provided log is a healthy reference run:

- ONEAPI version reports `3.3.0.rc2`.
- The event and command channels connect successfully.
- One device definition is received with 33 bin entries.
- The run contains one lot, one touchdown, four active sites, four test flows, and 45 test-suite starts/ends.
- It includes parametric, multi-parametric, functional, measurement, test-start/end, and lot-start/end events.
- All 136 test flags are `0x0`.
- All 125 explicit pass/fail tokens are `True`.
- All four parts finish in soft bin 1 and hard bin 1, with 34 tests per part.
- The log contains no error, warning, traceback, exception, or failed-connection signal.

Use this event ordering and final bin outcome as the regression baseline for your modified application.

## Preflight items missing from this folder

Ask the organizer or teammate for:

- the `oneAPI_py3.10` package with `liboneAPI.so`, `oneapi.py`, `oneapi_DFF.py`, logging helper, `main.py`, and `sample.py`
- `tag.sh`
- `runTp.sh` and its `Util` directory
- the SmarTest `Case_Smt870` test program and recipe
- `app_descriptor.json`
- the workshop's `example.csv` or another historical dataset
- team rules, challenge statement, judging rubric, required deliverables, presentation duration, and submission deadline

The last line matters: none of the supplied files contains judging criteria or a formal challenge brief, so do not overfit the project before those are confirmed.

## Questions to ask at kickoff

1. Is the required output an analysis/dashboard, a deployed Edge application, an automated control action, or any combination?
2. Will judging use a live SmarTest simulation, historical CSV, or both?
3. Which event types and test suites are guaranteed in the evaluation run?
4. Are control actions allowed, and is there a safe sandbox for `ActionManager`?
5. What latency, accuracy, false-alert rate, or business outcome will judges value?
6. Can teams use external Python packages and pretrained models?
7. Must the final image run without internet access?

## Five minute pitch

1. Problem: test anomalies can develop by site, pin, or time before a hard failure is obvious.
2. Input: ONEAPI supplies structured test events and measurements in real time.
3. Method: the application maintains per-test and per-site baselines and detects imbalance, drift, spread change, and shifts.
4. Output: each alert names the affected test, pin, site, evidence, and suggested response.
5. Impact: engineers get earlier, explainable signals without changing the test program, and the same container can move from Gemini simulation to production RTDI.

## Demo checklist

- App starts before the simulated lot.
- Connection request succeeds and connection state is checked.
- Lot metadata and device/pin definitions appear.
- Live measurements update without blocking the callback.
- One anomaly is deliberately injected or replayed.
- Alert names the site, test, pin, and reason.
- Lot summary shows devices, bins, alerts, and detector status.
- Logs are saved.
- Docker image is built and available before the final rehearsal.
- A fallback replay is ready.

## Security note

The workshop material contains live-looking shared access credentials and internal service addresses. Treat them as confidential, do not repeat them in the presentation or commit them to source control, and confirm current credentials through the organizer.

---

# Archived previous SESSION_HANDOFF.md

Preserved for historical evidence only. Do not execute its old grp1 resume instructions. Use CONTEST.md.
# Hackathon session handoff

## Authoritative team correction — 2026-09-19

The user explicitly confirmed: **we are grp6**. Use only `grp6_acs_host_controller` and `grp6_acs_edge_server` for this task. Do not continue work on grp1. All grp1 results and paths below are historical observations from the wrong team environment, not verified grp6 setup or test results.

Dashboard observed on 2026-09-19: grp6 host controller `180.3.13.36`, grp6 Edge `180.3.13.209`, both Up. Recheck the named rows when reconnecting. Select grp6's View button; do not reuse the historical grp1 VNC URL. Verify the remote hostname and package before running code or tests.

Current task: read the supplied documents, access grp6, use its remote code-server, finish the workshop tasks, and keep useful notes. Code-server access and end-to-end streaming must be verified afresh on grp6.

Verified on grp6 on 2026-09-19: user connected the desktop; terminal `hostname` returned `group-6`. `/home/user/Case_Event` contains `Edge`, `SmarTest`, `doc`, `firefox_128`, `images`, `training`, and the newly discovered challenge brief `Question_20260919.pdf`. Read that brief before selecting implementation scope. `pdftotext` is available, but Chinese output appeared garbled in Konsole; use a PDF viewer or download the file for local extraction. The grp6 VNC gateway path is `tevmip-180-3-13-67-endtevmip`, not the historical grp1 gateway. The connection displayed a network instability warning and temporarily returned to waiting-for-response during inspection. No grp6 source edits or test runs yet.

Saved: 2026-09-18. User timezone: Asia/Taipei. Intended resume: 2026-09-19.

## User goal and working preferences

Prepare for the Advantest hackathon using the supplied documents; help operate the **grp6 Gemini environment**. User prefers direct hands-on assistance and plain-language explanations. The remaining sections preserve the prior session's history; the correction above supersedes its team selection and resume instructions.

## Local reference files

Workspace: `C:\Users\USER\Documents\hackathon2026`.

- `HACKATHON_PREP.md`: document review, ONEAPI programming rules, suggested demo, build order, preflight, and pitch.
- `WorkShop_Material.pdf`: 30-slide workshop, main source for the run workflow.
- `ONEAPI_Manual.pdf`: 80-page SDK/Nexus manual.
- `py-app.dockerfile`, `requirements.txt`, `py-app.log`: supplied build/reference artifacts.
- `tmp/pdfs/WorkShop_Material.txt`, `tmp/pdfs/ONEAPI_Manual.txt`: extracted text with page markers; rendered intermediates also remain in tmp/pdfs.

Some original prep statements about missing files mean missing LOCALLY. The full SDK and SmarTest package were subsequently found remotely. Do not ask the user to obtain them again without checking the remote environment.

## Engineering versus production mode — verified documentation

Workshop slide 23 gives `./runTp.sh {load|eng_run|prod_run} [loop_count]`:

- `./runTp.sh load`: start SmarTest and load the target program.
- `./runTp.sh eng_run 1`: manually execute the program once; `eng_run 2` executes it twice. This is the workshop's development/debugging path for a ONEAPI app receiving real-time results. Load first if not already loaded.
- `./runTp.sh prod_run`: run the production simulation.

Slides 24–26 present the packaged deployment path: Docker image, `sudo ./tag.sh` to build/push to AUS, then production simulation. Slide 20 identifies the recipe directory as holding necessary production simulation files and an app descriptor as defining the image/container.

Practical distinction: engineering mode is the short manual debug loop; production mode rehearses the production/deployment workflow in the sandbox. It is not simply another spelling for a single manual run, nor does the name mean physical factory production in this virtual environment. The actual runTp.sh implementation and recipe have NOT been inspected, so exact production loop count, lifecycle, resets, and deployment side effects are unverified.

IMPORTANT: Do not assert that eng_run cannot stream ONEAPI events. Slide 23 explicitly describes manual execution for debugging real-time results. Missing events in our session are unresolved, not an established mode restriction.

## Remote environment and navigation

- Gemini dashboard: https://sandbox.gemini.te-cloud.advantest.com/dashboard/virtual-machine
- Group-1 VNC URL used: https://guasg.sandbox.gemini.te-cloud.advantest.com/tevmip-180-3-13-116-endtevmip/#/client/MQBjAG15c3Fs
- Host: group-1, Linux host controller with SmarTest.
- Code-server inside remote Firefox: `http://advantestcell.local:29080`.
- Edge persistent project directory: `/home/debugger/project`.
- Host engineer package: `/home/user/Case_Event`.
- Host SDK: `/home/user/Case_Event/Edge/oneAPI_py3.10/bin`.
- Edge SDK: `/home/debugger/project/oneAPI_py3.10/bin`.
- Host SmarTest commands directory: `/home/user/Case_Event/SmarTest`.
- SmarTest workspace: `/home/user/Case_Event/SmarTest/workspace`.
- Group-1 target IP noted earlier: `180.3.13.224`; recheck before relying on it for any changes.

User manually authenticated and accepted the code-server workspace trust prompt. Do not store or repeat passwords. Workshop slides 9 and 21 contain access information if the user needs to consult them. Session authentication may expire overnight.

## What was actually performed

### 1. Started the unmodified SDK sample in code-server terminal

```bash
cd /home/debugger/project/oneAPI_py3.10/bin && python3 -u main.py
```

Observed output:

- Library loaded.
- Log level INFO.
- Connect to Event Port Success.
- KafkaConsumer starts consuming messages.
- DealerClient starts connection.
- Connect to Command Port Success.
- Connection request initiated successfully.
- Later: `Communication state changes: enable` at displayed log time 2026-09-18 11:58:33.

No measurement/test/lot result callback output was observed even after the engineering run. The program was still running at the last check. A successful connection is NOT proof that the result stream was received.

Read-only inspection of main.py showed app name `sample`, vendor `adv`, version `1.0.0`, NexusDataEnabled=True, TPServiceEnabled=True, monitor registration, Interface.connect, and signal.pause loop. sample.py has callbacks that print results; no edits were made.

### 2. Loaded SmarTest from host Konsole

```bash
cd /home/user/Case_Event/SmarTest && ./runTp.sh load
```

Loader cleaned up prior SmarTest/Tcct processes and started the work center. A kill permission warning occurred during cleanup, but the program loaded and the UI reached System ready. Initially the flow title showed `TestCase1_4site_cp.prog`. The report window showed OFFLINE, consistent with a virtual setup but not independently diagnosed.

### 3. Executed exactly one engineering run

```bash
cd /home/user/Case_Event/SmarTest && ./runTp.sh eng_run 1
```

Completed command output:

```text
command =/home/user/Case_Event/SmarTest/Util/tpExec
test program: TestCase_Smt870/src/TestCase1/TestCase1_4site_ft.prog validate mode: Run 1/1
Site : 1 , sbin: 1 , sbin name: passed , hbin: 1
Site : 2 , sbin: 1 , sbin name: passed , hbin: 1
Site : 3 , sbin: 1 , sbin name: passed , hbin: 1
Site : 4 , sbin: 1 , sbin name: passed , hbin: 1
```

The shell prompt returned. SmarTest's Site Result panel independently showed 4 available, 4 enabled, 4 passed. There were 0 errors and 5 warnings in the Problems panel (4 build warnings plus 1 runtime warning). Console included a license validation warning: no valid license found / license check failure. It also showed NexusTPI creation and test-stage output. The exact full license message was clipped; the license warning's cause and effect are NOT established.

Note the loaded UI's cp filename versus completed command's ft filename. Preserve this evidence and inspect the script before asserting they are identical programs.

## Current status and limits

- CONFIRMED: access to code-server, SDK sample starts, event/command connections succeed, one simulated engineering run passes all four sites with soft/hard bin 1.
- NOT CONFIRMED: end-to-end test-result delivery into this running Python sample.
- NOT DONE: production simulation, Docker image build/push/deployment, application code modifications, detector/dashboard implementation.
- Supplied local py-app.log is a reference run, NOT the output of our live session. It contains a successful four-site stream with 34 tests per part; do not confuse that with live verification.
- Last foreground remote window: host Konsole displaying the completed engineering run and prompt. Firefox/code-server sample and SmarTest were left open. Recheck all state tomorrow.

## Resume plan

1. Read this file and HACKATHON_PREP.md. Inventory browser tabs and inspect the existing VNC session; do not assume prior tool bindings persist.
2. Confirm the Python process is still running and inspect any new output. Avoid starting duplicate sample instances.
3. Inspect runTp.sh, its called utilities/recipe, and relevant logs read-only. Determine engineering/production differences and the cp/ft selection.
4. Investigate missing ONEAPI results: actual Nexus/test-cell association, event configuration, app identity/registration, and the license warning. Treat these as checks, not established causes. Do not change licenses/security settings or restart Nexus indiscriminately.
5. Explain production prerequisites and side effects before requesting any additional deployment authority. When authorized, follow the workshop's sandbox production path and verify lot start, measurements, test end, lot end.
6. Once streaming is proven, implement a small demo such as site imbalance detection using copied callback payloads and a worker queue. Confirm challenge rules before expanding.

Do not restart Nexus during a SmarTest session: the manual warns this can interfere with container cleanup/deployment. Ensure the app is running before production begins to avoid losing beginning-of-lot data.

## Browser operation notes for the next assistant

Use the available computer-use skill/instructions and browser control tools. Previously used mcp__cua_repl with browser ID `1`, VNC tab `3`, dashboard tab `2`; these IDs must be rediscovered if changed. Native computer APIs were disabled. The VNC page is an opaque canvas; its accessibility tree exposes hidden text inputs, not the remote desktop content. Use screenshots to inspect the remote UI.

Individual pressKey calls reliably sent text into VNC; typeText did not. Example key map used for remote Linux shell input:

```javascript
const remoteKeys = {' ':'space','/':'slash','-':'minus','_':'underscore','.':'period','|':'bar', ':':'colon','&':'ampersand'};
for (const ch of 'command verified for the current task')
  await vncTab.pressKey(remoteKeys[ch] || ch);
await vncTab.pressKey('Return');
```

Alt_L+Tab switched remote windows. Control_L+grave opened the code-server terminal. Screenshots and click coordinates used different scaling in the last session: a 1558x1143 screenshot corresponded approximately to a 1403x1029 interaction surface; bottom taskbar Firefox was clicked at [150,896], Konsole at [342,896]. These are historical hints, NOT coordinates to reuse without inspecting a fresh screenshot. Black screenshots sometimes cleared on the next read. VNC reload previously reconnected without stopping apps; avoid unnecessary reloads.

Preserve user files and avoid destructive cleanup. Prior attempts to remove temporary PDF intermediates were rejected; do not retry via a workaround. No secret values should be included in future handoffs or chat.

## Suggested user prompt tomorrow

“Read SESSION_HANDOFF.md and HACKATHON_PREP.md, reconnect to my group-1 VNC session, and continue checking why the Python sample is not receiving test results.”
