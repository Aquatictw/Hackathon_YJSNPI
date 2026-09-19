# grp6 design and frontend data handoff

Updated September 19, 2026. This describes the implemented **grp6_app**, not every proposed feature in the LLM architecture.

## What are we doing?

We are building a semiconductor test assistant with two functions:

1. **Predict six temperature targets during a chip test.** The tester requests target 1–6. We return one prediction per active site, using eligible measurements from that current test.
2. **Detect unusual wafer behavior and explain it.** As devices finish, we track site imbalance, low yield, mean drift, and spread changes. Each alert contains evidence, plot data, and an investigation suggestion. The app queues a tester message and generates a report.

The frontend displays status, predictions, wafer results, and alert evidence. Models and detectors run on the Edge VM; the browser does not run the models.

## Current architecture

~~~text
OFFLINE
25 training CSVs + actual tester flow files
  -> wafer-separated training / detector calibration
  -> six models + allowed-feature manifest + validation metrics

LIVE ON GRP6
SmarTest / tester -> ACS Nexus -> ONEAPI -> Python Edge app
  |                                        |
  |    current test/site measurement cache <-+
  |                  |
  |    target request 1..6 -> model -> prediction
  |                                        |
  +<- ONEAPI prediction actions -----------+
  +<- ONEAPI anomaly messages -------------+
                                           |
                          JSONL evidence + HTML report
                                           |
                  exporter/backend -> frontend dashboard
                     [this connection is still pending]
~~~

The current app has no deployed dashboard HTTP/SSE endpoint. Your teammate can start immediately using our replay JSON files and preserve the same alert structure for live integration later.

## What exactly is running?

| Component | Input | Processing | Output |
| --- | --- | --- | --- |
| Offline training | 25 CSVs, 2,000 devices, nested test flows | Six Ridge models; five folds separated by wafer; feature selection inside training folds | Model artifacts, manifest, validation JSON |
| Live Edge application | ONEAPI lifecycle/measurement callbacks and prediction requests | Current-site cache, inference, anomaly detection | SDK actions, JSONL evidence, generated HTML |
| Replay runner | Supplied CSVs and saved models/detector | Replay device order and evaluate detection | summary.json, replay.jsonl, report.html |
| Evidence auditor | Recorded live JSONL | Check coverage, errors and callback latency | Audit JSON; tester receipt requires separate evidence |
| Frontend/backend | Planned: exported events; available now: replay files | Storage, visualization, report distribution | Interactive analysis board |

The deployed entrypoint is **grp6_app.live_main.main()**, loaded by the supplied SDK main.py inside the Edge container. It registers a Monitor and waits for callbacks. It is not currently an HTTP server or LLM agent. Code-server is the development workspace; the deployed container is a separate runtime.

Latest uploaded image: unifiedserver.local/grp6/py-app:20260919T052422Z. Runtime: Python 3.10 with the supplied native SDK.

The most recent test was:

~~~bash
cd /home/user/Case_Event/SmarTest
DISPLAY=:1 XAUTHORITY=/home/user/.Xauthority bash runTp.sh eng_run 1
~~~

That engineering run **has finished**: four device results, six prediction requests. We collected Edge logs and the tester datalog. A production rehearsal has not yet been completed.

## What does ONEAPI do?

Here the name is **Advantest ONEAPI**: the supplied bridge between our Python application and ACS Nexus/the tester. It is not an OpenAPI/Swagger specification or an OpenAI model call.

- **consumeData(tc, data):** receives SDK objects for lot/wafer/test lifecycle, measurements, and device completion. These input objects are not frontend JSON. We copy their values during the callback.
- **consumeTPRequest(tc, request):** receives a JSON string such as {"key":"predict","data":1}.
- Our code calculates predictions, then calls **ActionManager.set_wait(tc.testerId, 10, message)** and **get(tc.testerId)**. The callback returns the SDK action string expected by the supplied tester program.
- The prediction message looks like **prediction 1: (1,31.2) (2,30.9) ...**. These example values are illustrative.
- **ActionManager.set_message(tc.testerId, message)** queues an anomaly message. A production **prod_action** request retrieves it through **get_prod**.

ONEAPI transports measurements, requests and actions. Our code does the analysis. No LLM currently generates predictions or decides alerts; investigation suggestions are deterministic text.

**Queued, returned, and confirmed are different delivery states.** Only a matching tester record/display proves receipt.

## Files the frontend can consume now

Paths below are relative to the shared repository unless marked remote.

| File | Format / content | Frontend use |
| --- | --- | --- |
| results/replay/summary.json | JSON object: wafers, yield, alerts, validation, limitations | Best starting input for the analysis board |
| results/replay/replay.jsonl | One alert JSON object per line | Replay event timeline |
| results/replay/report.html | Standalone searchable HTML with plots | Existing report reference |
| grp6_app/artifacts/validation.json | Aggregate held-out model metrics | Accuracy and baseline comparison cards |
| results/model_revalidation/validation.json | Per-wafer/site metrics and fold membership | Detailed model evaluation |
| Remote /tmp/grp6_evidence.jsonl | Live evidence inside Edge container | Needs collection/export |
| Remote /home/user/Case_Event/grp6_channel_evidence.jsonl | Latest collected engineering-run JSONL on host | Real callback fixtures |

**JSONL is not a JSON array:** parse each nonempty line separately. Edge stdout mirrors each record with a GRP6_EVIDENCE prefix; strip that prefix when extracting.

## Actual data types

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

Illustrative prediction JSON, **not copied from a live log**:

~~~json
{
  "time": 1789795900.0,
  "kind": "prediction_request",
  "tester": "group-6",
  "stage": 1,
  "status": "response_queued",
  "predictions": {"1": 31.2, "2": 30.9, "3": 31.1, "4": 31.4},
  "coverage": {"1": 1.0, "2": 1.0, "3": 1.0, "4": 1.0},
  "feature_counts": {"1": 25, "2": 25, "3": 25, "4": 25},
  "missing_features": {"1": [], "2": [], "3": [], "4": []},
  "waited_for_measurements": false,
  "lifecycle_changed": false,
  "latency_ms": 0.75,
  "response": "<SDK action string omitted in this example>"
}
~~~

## How to display the data correctly

- **Predictions:** show stage, site, value, coverage, latency, and delivery state. Coverage 1 means all selected inputs are present; it does not mean 100% accuracy. Empty predictions mean insufficient data, not zero temperature.
- **Accuracy:** use validation.metrics for held-out MAE/RMSE. prediction_in_sample_mae is fitted-data replay error and must not be presented as independent validation.
- **Alert plots:** site_series maps each site to values in completed-device order within that site. Plot array index on the x-axis; these are not timestamps. Alerts contain selected evidence, not all 3,036 measurement columns or a spatial wafer map.
- **Low yield:** series is cumulative yield; observed and reference are fractions, with reference 0.8. Display them as percentages.
- **Units:** physical temperature units are unverified. Display “CSV units” or “unit unverified”; do not assume °C.
- **Time:** live time is Unix seconds, so use new Date(event.time * 1000). Replay alerts currently lack timestamps.
- **Identity:** site IDs are strings. Replay wafer IDs are numbers and live wafer IDs are strings; normalize wafer IDs to strings. Live unknown IDs may be empty.
- **Source status:** replay events explicitly say mode=replay; raw live events omit mode. The backend must attach provenance. Missing mode does not prove live freshness.
- **Errors:** request_error, callback_error, action_error and report_error are separate records. Show failure/insufficient-data states instead of treating missing data as normal.

## What is missing for a live dashboard?

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

**Suggested first frontend deliverable:** import summary.json and build a replay board with a provenance banner, wafer/yield overview, alert cards, per-site evidence plots and model-validation table. Preserve AlertEvidence so the same cards can later render live events. Add the prediction grid when supplied with prediction events.

## Current verified progress

- Six trained models and wafer-grouped validation exist, including per-wafer/site metrics.
- Latest image passed 12 packaged runtime tests on grp6; 17 local tests passed.
- Fresh engineering run: all six prediction requests had full selected-feature coverage on all four sites, zero callback errors, callback latency 0.57–1.05 ms.
- Tester datalog **grp6_channel_tester.edl** contains all six prediction actions, each with **Exec Pass: 1 / Exec Fail: 0**. This proves action handling for this run, not live prediction accuracy or production robustness.
- The bounded 200 ms feature wait was not exercised in this run; delayed-arrival recovery is locally tested but still needs live evidence.
- Detector replay finds the expected category on **6/7** labeled anomaly wafers; W25 spread decrease remains missed. Normal examples were inspected during development, so false-alarm results are not independent validation.
- The HTML report exists. A real detected anomaly reaching tester display through production set_message / prod_action remains to be proved.
- Next work: production rehearsal and alert receipt, W25 diagnosis, and exporter/backend integration with the frontend.

Implementation references: grp6_app/monitor.py (events/actions), runtime.py (inference/detection), state.py (current-test isolation), rehearse.py (replay JSON), report.py (current user report), build_models.py (validation).

