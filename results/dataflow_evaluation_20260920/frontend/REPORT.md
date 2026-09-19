# Frontend/backend dataflow and run-identity audit — 2026-09-20

**Finding: the deployed experience is a working persisted replay, with no live Edge export configured.** Local source already implements exporter ingestion, scoped storage, prediction projection, snapshot and SSE. Enabling and verifying the actual Edge exporter is the immediate transport requirement. Run discovery, correlated tester receipts and complete live reporting remain separate implementation gaps.

## Scope and evidence labels

Audit base: local HEAD `69658a7e8be941bdadb062229bd567a09013a6aa`. Read AGENTS.md, the explicitly invoked ADHD skill and SYSTEM.md. Source references below are repository-relative paths with one-based line numbers at the audited working tree. Historical source references explicitly include their revision. This report is an evaluation artifact, not a replacement for SYSTEM.md.

**Local inspection:** source, tests, retained JSON/JSONL, ZIP contents and local SQLite using read-only connections. No browser, remote commands, network mutations, migration, seeding, build, app edit or git mutation was performed. The only authored output is this report.

**Fresh parent-confirmed evidence, supplied in this conversation:** VPS SQLite has exactly one run: `run_id=grp6-replay-demo`, `tester_id=grp6-replay`, `edge_id=grp6-replay-exporter`, `mode=replay`, with 114 events. Public UI SSE works. The grp6 descriptors specify only `ONEAPI_DEBUG=1` and `ACTIONS_FILE_PATH`; the pinned image has no export environment configuration, specifically no `GRP6_EXPORT_URL`. These observations were not independently collected by this local auditor; the parent's DB/browser/VM artifacts are their authoritative evidence.

**Historical evidence:** retained deployment records identify prior checks and builds, not a fresh observation of running bytes. A source implementation, a packaged ZIP, a registry image and the running Edge container are distinct evidence levels.

## 1. Run identity and discovery

### Default replay and what the UI actually loads

| Boundary | Exact behavior | Source evidence |
|---|---|---|
| Workspace default fields | `grp6-replay-demo` / `grp6-replay`. These are editable defaults, not aliases for the newest live run. | `frontend/app/workspace/page.tsx:79`, `:133` |
| Initial connection | Mount connects an explicit initial scope or restores a saved browser-tab scope. A fresh tab without either does not automatically fetch the prefilled pair. | `frontend/app/workspace/page.tsx:89`, `:95`; `frontend/lib/rtdi/ui-lifecycle.ts:166` |
| Imported report | Source session is resolved before backend mounting. A saved import opens the offline workspace; explicit Load backend run switches source. | `frontend/app/workspace/page.tsx:56`, `:73`; `frontend/tests/source-session.test.mjs:9` |
| Seed alerts | Converts 14 retained replay alerts to fixed run/tester/edge, with synthetic start `2026-09-19T00:00:00Z`. | `frontend/scripts/local-backend.mjs:19`, `:20`; `frontend/lib/rtdi/replay-adapter.ts:48` |
| Seed predictions | 52 originals: 24 requests, 24 actuals, four device bundles. Projection adds 48 prediction/actual records. Total: 14 + 52 + 48 = 114 stored events, not 114 machine actions. | `frontend/scripts/local-backend.mjs:21`; `grp6_app/preview_seed.py:17`, `:37`, `:69`; `frontend/tests/seed.test.mjs:12` |
| Seed guard | Rejects live events and unexpected run/tester; content-derived batches and strict ACK checking. Seed command was inspected, not executed. | `frontend/scripts/seed-support.mjs:5`, `:17`; `frontend/tests/seed.test.mjs:33`, `:38` |

The 24 seeded predictions cover six stages across four selected sites/devices. They use fitted replay inputs and synthetic time, and contain no tester execution receipts. Their joins demonstrate data handling, not independent prediction accuracy or live acceptance (`grp6_app/preview_seed.py:17`; `grp6_app/tests/test_preview_seed.py:31`, `:47`, `:55`, `:64`).

### All identity-producing paths and possible stored values

There is **no closed list of allowed run or tester IDs**. Both wire validators accept arbitrary nonempty strings up to 120 characters (`frontend/lib/rtdi/wire.ts:3`; `frontend/lib/rtdi/exporter-wire.ts:4`). Authorized ingest can therefore create additional scopes beyond every fixture or saved example below. The parent's current DB inventory is exactly one replay scope; local code alone cannot enumerate remote rows.

| Producer | Run ID | Tester / edge identity |
|---|---|---|
| Default seed | `grp6-replay-demo` | Tester `grp6-replay`; edge `grp6-replay-exporter` (`frontend/scripts/local-backend.mjs:20`) |
| Standalone replay conversion CLI | Default `grp6-replay-<UTC date>`, overrideable | Default tester `grp6-replay`, edge `grp6-replay-exporter`, also overrideable (`frontend/scripts/replay-edge-jsonl.mjs:14`) |
| Live Monitor | Process fallback `uuid4().hex`; each tester's LotStart creates a new independent `uuid4().hex` run and resets its export sequence. WaferStart does not rotate run. | Tester is `str(tc.testerId)`; exporter edge defaults to `grp6-edge`, configurable with `GRP6_EDGE_ID`. No `GRP6_RUN_ID` setting was found. (`grp6_app/monitor.py:30`, `:105`, `:180`, `:183`, `:230`; `grp6_app/exporter.py:72`) |
| Formal ingest | Any valid supplied run/tester, including live/replay/simulation | Envelope edge ID is separate from tester ID (`frontend/lib/rtdi/wire.ts:8`, `:80`; `frontend/lib/rtdi/exporter-wire.ts:7`, `:21`) |
| Synthetic examples/tests | E.g. `DEMO-RUN-001`, `DEMO-RUN-WIRE`, `run`, `r1`, `r2-run`, `r3-run`, `RUN-LIVE-1`, `RUN-REPLAY-1` | E.g. `grp6-demo-tester`, `tester`, `t1`, `r2-tester`, `r3-tester`, `group-6`, `grp6-replay`. These are fixtures, not deployed inventory (`frontend/lib/rtdi/fixtures.ts:4`; `frontend/contracts/examples/edge-v1-batch.json:3`; backend storage tests). |

The formal example's `edge_id=group-6` does not make its tester `group-6`; its tester is `grp6-demo-tester`. Likewise host name, tester name and edge ID must not be interchanged.

Raw JSONL uses numeric schema 1, `kind`, `tester`, ISO timestamp, `source_mode`, and a process-wide sequence. Export events use string schema 1, `event_type`, `tester_id`, Unix timestamp, `mode`, and tester-specific sequence. Selected raw source IDs are preserved during export; some export-only records obtain a separate ID. Startup log presence does not mean it was exported (`grp6_app/monitor.py:73`, `:90`, `:105`, `:474`).

### Observed retained machine identities

Counts below were read from saved files. They establish historical log provenance only, not ingestion, current connectivity or current DB storage. A missing tester field is not an empty-string tester accepted by the ingest schema.

| Saved file and first line | Run ID | Tester | Records |
|---|---|---|---:|
| `results/vm_engineering/grp6_core_eng_evidence.jsonl:1` | `71e51786fb4e47be931d2572bc392976` | absent; monitor startup | 1 |
| Same file `:2` | `ae20cd5ae29d47af87163265205ffced` | `group-6` | 51 |
| `results/vm_production/grp6_core_prod3_evidence.jsonl:1` | `87c55d69705941ea846910bdb2f31276` | absent; startup | 1 |
| Same file `:2` | `87c55d69705941ea846910bdb2f31276` | `group-6`; pre-lot | 1 |
| Same file `:3` | `d132133657be459e8e97b6fd442142e2` | `group-6` | 763 |
| `results/vm_production/grp6_core_prod3_capture_all.jsonl:1` | `a3aa6a396c1b4e159f170da15895bc0f` | absent; additional startup-only process | 1 |
| Same capture-all file `:2`, `:3`, `:4` | The two `87c…` groups and `d132…` group above | same respective testers | 765 combined |
| `results/replay/predictions.jsonl:1` | `grp6-replay-demo` | `grp6-replay` | 52 |
| `results/replay/replay.jsonl:1` | absent until adapter conversion | absent until adapter conversion | 14 |

The inspected local Wrangler application SQLite file, `frontend/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`, had no application tables. The inspected metadata files had only `_cf_ALARM`. This says nothing about VPS contents; the parent's fresh query supplies that inventory.

### Discovery is missing; scoped lookup is implemented

`frontend/app/api/v1/runs/[id]/route.ts:4` supports lookup by exact run, with optional tester. `frontend/lib/rtdi/repository.ts:226` queries only that ID: zero matches → 404; multiple testers → 409; unique match pins the tester. No `/api/v1/runs/route.ts`, list-runs repository operation, latest-live selector or UI run picker exists in the inspected route/source tree. The workspace provides manual text fields (`frontend/app/workspace/page.tsx:133`).

Stored run uniqueness is `(tester_id, run_id)`; stored event uniqueness is `(run_id, tester_id, event_id)` (`frontend/drizzle/0000_grp6_backend.sql:25`, `:50`). The UI resolves and pins tester before opening SSE/chat (`frontend/lib/rtdi/ui-lifecycle.ts:98`, `:117`; tests `frontend/tests/ui-lifecycle.test.mjs:66`, `:232`). Public incident lookup still lacks a tester selector and returns ambiguity when run alone cannot distinguish testers (`frontend/lib/rtdi/repository.ts:380`; `frontend/tests/backend-storage.test.mjs:580`).

**Consequence:** after live ingestion starts, a known generated run/tester pair is sufficient to load it manually. Nothing currently changes the replay defaults to a new live run or discovers that pair for the operator.

## 2. Three separate data paths

### Static summary / offline import

`results/replay/summary.json` → copy script → `frontend/public/replay/summary.json` → `/` or `/replay` → browser state. The homepage exports the replay page (`frontend/app/page.tsx:1`); that page fetches `/replay/summary.json` (`frontend/app/replay/page.tsx:49`). `frontend/scripts/sync-replay.mjs:4` performs the copy. Browser import reads a file of at most 5 MiB locally and persists the source in tab storage, without uploading it (`frontend/app/replay/page.tsx:79`).

The summary and backend snapshot are different formats and stores. Ingest does not regenerate this summary. Replay page references are local wafer/alert indices, not backend event IDs (`frontend/app/replay/page.tsx:98`). Its validation metrics are aggregate offline evaluation (`:116`), and `live_integration` is rendered verbatim as a source-report field (`:117`). Accepted summary still says `NOT YET PROVED`, 6/7 expected anomaly wafers, W25 missed (`results/replay/summary.json:3`, `:1473`). A new source candidate or live connection must not silently reinterpret this historical summary.

Local source/public summary bytes were identical: 41,151 bytes, SHA256 `f086d2c6887aef9fd34e7804c7e56de36f826d71b49e3927e7261913487d856c`. The public source manifest hash `91b100c5ae943c1085fadaa3bf14935ed4b405ab51e8d93bd8ea4f76874ba184` matches LF-normalized content; the working copies use CRLF. This is line-ending provenance, not a semantic summary mismatch.

### Persisted replay / live-capable backend

Source events → optional exporter or replay adapter → `POST /api/v1/events/batch` → atomic DB source/raw/projection writes → `GET /api/v1/runs/{id}?tester_id=…` → workspace → scoped SSE refresh.

| Layer | Implemented behavior and limit | Source evidence |
|---|---|---|
| Ingest | Bearer INGEST_TOKEN; gzip; exporter bounds 4 MiB compressed / 8 MiB decompressed; formal normalized JSON limit 256 KiB; invalid/conflicting content rejected. | `frontend/app/api/v1/events/batch/route.ts:8` |
| Normalization | Exporter alerts become evidence/incidents; other originals become run_summary with raw payload retained. Numeric or string exporter schema 1 accepted. Raw core JSONL is not this envelope. | `frontend/lib/rtdi/exporter-wire.ts:7`, `:21`, `:66`, `:118` |
| Projection | prediction_request and prediction_actual create per-site records; preserve original_request_id and source_event_id; unknown units null; no invented actuals. Joins require uniquely compatible scope and source. | `frontend/lib/rtdi/backend-projection.ts:25`, `:78` |
| Persistence / ACK | Raw chunks and projections commit atomically; ACK arrays refer to original source IDs. Same-batch duplicate shortcut does not backfill projections; unchanged source in a new batch can backfill. | `frontend/lib/rtdi/repository.ts:87`, `:147`, `:207`, `:223` |
| Run mode | Supplied source mode is stored; live is sticky on upsert. A live label is source-reported provenance, not an authenticated machine heartbeat. | `frontend/lib/rtdi/repository.ts:159`; `frontend/app/workspace/page.tsx:128` |
| Snapshot | Returns all scoped events, joined predictions, incidents and commands; event history is unpaginated. | `frontend/lib/rtdi/repository.ts:226`, `:237`, `:248` |
| SSE | Scoped DB rowid cursor; 25-second stream cycles, ready, edge_event and 10-second server heartbeat; polls storage, not Nexus. | `frontend/app/api/v1/runs/[id]/events/route.ts:9`, `:27`, `:36`; `frontend/lib/rtdi/repository.ts:265` |
| UI refresh | ready/edge_event/heartbeat trigger serialized/coalesced full snapshot fetches. They do not append the SSE event body directly to UI state. Retains last snapshot during reconnect/disconnect. | `frontend/lib/rtdi/ui-lifecycle.ts:98`, `:117`, `:179` |
| Config | Reports key/token/DB binding presence and configured model. No build revision, exporter health or end-to-end delivery proof. | `frontend/app/api/config/route.ts:5` |

Public SSE can therefore work perfectly while the only records remain replay. The parent-confirmed 114-event replay and absent export URL are consistent with this exact source behavior.

### Measurements, receipts and commands

The backend reconstructs scoped raw device bundles through `GET /runs/{id}/measurements`, requiring tester_id and event_id, with paging and response bounds (`frontend/lib/rtdi/backend-measurements.ts:3`, `:10`). The workspace Temperature tab consumes snapshot prediction/actual rows; neither workspace nor TemperatureRecords fetches the measurement route (`frontend/app/workspace/page.tsx:148`; `frontend/components/temperature-records.tsx:32`). Full raw measurements and baseline artifacts are retained, but do not constitute a complete live wafer/report UI.

Monitor exports action_message and production_action_response source records (`grp6_app/monitor.py:90`), while its callback return is explicitly unconfirmed (`:512`). Exporter normalization does not map these into confirmed evidence receipt state: they remain generic run_summary originals (`frontend/lib/rtdi/exporter-wire.ts:66`, `:105`). Anomaly alert projection also does not attach a confirmed tester receipt. Historical receiver-boundary arrival is not tester parsing/execution/display acceptance.

Backend command creation, pending polling and result ACK storage exist. Creation is same-origin plus explicit confirmation/live-incident validation (`frontend/app/api/v1/runs/[id]/commands/route.ts:6`; `frontend/lib/rtdi/repository.ts:281`). Pending/results use COMMAND_TOKEN (`frontend/app/api/v1/commands/pending/route.ts:12`). No Edge command poller/executor was found under grp6_app; SYSTEM.md explicitly identifies it as remaining integration. No command-creation UI exists (`frontend/app/workspace/page.tsx:149`).

Important nuance: absent COMMAND_TOKEN disables the authenticated execution channel, but command creation itself does not check that token. Thus config's commands-disabled indicator is not a global creation kill switch if a live incident were available. Current replay-only storage separately prevents live-only command creation. Optional remote commands are not required just to display live data.

## 3. Exporter and bundle compatibility

| Version/evidence | Supported behavior | What it does not prove |
|---|---|---|
| Current local exporter | `from_env` returns None if URL absent; copied bounded queue → SQLite worker → gzip HTTPS; stable batch IDs; validates matching/disjoint known ACK IDs; retries omissions; quarantine and restart handling. | Code and tests do not establish actual-container enablement, persistent volume, endpoint reachability or callback-load acceptance. `grp6_app/exporter.py:64`, `:78`, `:127`, `:207`, `:216`, `:269`, `:347`. |
| Alert-fix-era source, revision `769c982` | Optional env exporter, gzip string-1 format, backend-compatible event shapes. | That revision's exporter uses shallow copy, random batch UUID per attempt and deletes attempted events after any 2xx without ACK validation (`grp6_app/exporter.py:44`, `:58`, `:111`, `:142` at that revision). It lacks later hardening. Historical source is not certification of the deployed archive. |
| Retained `grp6_channel_fix.zip` | Contains older Monitor. | ZIP has no grp6_app/exporter.py and Monitor has no from_env. SHA256 `21c52ec6bd795414b61da86c8c49ba78f1e0cbab8a7466100bb7c69c13ffb270`, 311,583 bytes. |
| Retained `grp6_core_evidence.zip` and `grp6_deploy.zip` | Identical older bundles. | Both lack exporter.py and Monitor from_env. SHA256 `c49930d9a7ecb55ad4a77a38a705c58095406be234572c21558bc4e8d07d762c`, 331,948 bytes each. Generic filename is not proof of the newer pinned release. |
| Recorded alert-fix release | Archive `grp6_core_alert_json_fix_20260919.zip`, 337,747 bytes, SHA256 `6522964d0e1deffa16ca0d50c5cd1909b7172b9bd565efc6c1a92c034a9264fa`; 31 packaged tests; image `unifiedserver.local/grp6/py-app:20260919T084518Z`. | That archive was not present among local root ZIPs inspected. Record explicitly leaves actual Edge digest, new-lot anomaly delivery and final-boundary delivery unverified (`results/vm_production/alert_fix_deployment_20260919.json:7`, `:17`, `:36`). |
| Current packager | Includes exporter.py and current artifact set. Installer builds/tests/pushes supplied package. | Current packaging is not proof that a retained ZIP or running image has current code. No export-env injection found in installer. `deploy/package_grp6.py:12`; `deploy/install_grp6.py:30`, `:38`. Static AppInfo version 1.0.0 is insufficient release identity (`grp6_app/live_main.py:13`). |
| Recorded VPS revision | `14ff55bfd31694e49ff324564b13c0535d16fe9a`, checked 2026-09-19T16:10:18Z; record reports replay 114 events, 24 predictions/joins, measurement access and SSE. Local git diff from this revision to audit HEAD under frontend is empty. | Source equality supports feature correspondence; it does not itself verify deployed bytes. Parent now independently confirms actual one-run DB and public SSE. `results/vps_frontend_adjustments_20260920.json:2`, `:24`. |

Version numbers alone are insufficient: core JSONL numeric 1, exporter string/numeric 1, normalized envelope numeric 1 and internal UI `0.1-draft` are different shapes. The replay adapter requires replay alerts, not arbitrary machine logs (`frontend/lib/rtdi/replay-adapter.ts:6`). Its IDs use edge/run/tester plus ordinal; changed source content/times under the same identity can conflict rather than silently replace records.

**Confirmed enablement gap:** missing `GRP6_EXPORT_URL` makes the optional exporter disabled in the inspected env-gated implementations. It does not prove whether the pinned bytes contain the exporter at all. A correct release must both contain the intended exporter and receive endpoint/token/storage configuration. Merely setting the URL on an older bundle without exporter support cannot implement the path.

## 4. Exact remaining live integration requirements

These are scoped findings, not authorization to deploy, mutate the database or operate the tester. Owners follow SYSTEM.md; A coordinates cross-boundary changes.

| Priority / owner | Missing requirement | Existing implementation and precise acceptance boundary |
|---|---|---|
| P0 transport / A with D | Identify actual running Edge bytes; deploy the intended exporter if absent/older; supply HTTPS ingest URL, matching token, unique edge ID and durable outbox storage. | Parent confirms URL absent. Current defaults are `/tmp/grp6_export.sqlite3`, queue 32, batch 1, timeout 5 s (`grp6_app/exporter.py:64`). Persisted outbox survives only if its backing storage survives; enqueue success is volatile. Verify actual container DNS/TLS/proxy/gzip limits and durable ACK, not just host connectivity. |
| P0 evidence / A with D/E | Correlate a genuine machine event through export/outbox, backend committed raw/source/projection, snapshot and UI SSE under its generated run/tester. | APIs already exist. Match source event IDs and payload provenance; do not use replay IDs, source-mode label or SSE ready as machine proof. Include missing actual, outage/retry/restart and bounded callback-load acceptance. `repository.ts:207`, `backend-projection.ts:25`, `ui-lifecycle.ts:117`. |
| P1 operator discovery / D/E through A | Provide generated run/tester handoff; implement scoped run-list/filter/latest selection if operators must discover runs through the website. | Manual known-pair loading is currently sufficient for minimum transport acceptance. No list API/UI exists. Add mode, tester/edge, last source/receipt time and explicit source selection; retain 409 ambiguity behavior. `repository.ts:226`; `workspace/page.tsx:133`. |
| P1 truthful live/receipt status / A/D/E | Define exporter health/freshness separately from server heartbeat; ingest and correlate actual tester receipts with source alert/action IDs. If remote commands are required, implement the Edge poll/execute/result client. | No Edge heartbeat producer or command poller found. Current action logs do not project confirmed receipts; source live and config presence are insufficient. `monitor.py:90`, `:512`; `exporter-wire.ts:105`; `events/route.ts:36`; `commands/pending/route.ts:12`. |
| P1 complete live product / D/E with A | Integrate raw measurement browsing and live aggregate reports; validate units/retest/head semantics, sustained snapshot cost, user/run authorization and durable quotas before production exposure. | Measurement API exists but UI does not call it; offline summary never updates from ingest; full-history refetch can grow without bound. Same-origin is not authentication. These are broader product/production gates, not proof that ingest is absent. `backend-measurements.ts:10`; `repository.ts:237`; `workspace/page.tsx:148`; SYSTEM.md “Implemented local API and UI” and remaining G5–G8 gates. |

## 5. Validation and existing tests

Fresh targeted local execution during this audit: **92 passed, 0 failed, 0 skipped**, Node v24.15.0; reported duration 1,749.9627 ms. Executed from frontend:

```text
node --test tests/backend.test.mjs tests/backend-storage.test.mjs tests/ui-lifecycle.test.mjs tests/seed.test.mjs tests/source-session.test.mjs tests/ui-projection.test.mjs
```

The storage harness runs actual SQL in in-memory SQLite with a mocked Cloudflare binding and invokes handlers directly (`frontend/tests/backend-storage.test.mjs:9`). It does not prove deployed D1 concurrency or machine/network acceptance. No full build or browser suite was rerun.

| Area | Relevant existing test locations | Coverage / limits |
|---|---|---|
| Projection/storage | `frontend/tests/backend-storage.test.mjs:79`, `:104`, `:144`, `:166`, `:177`, `:501`, `:518`; `frontend/tests/ui-projection.test.mjs:16`, `:30`, `:35` | Atomicity, provenance, unique scoped joins, source-mode isolation, unavailable actuals, retry/conflict handling. Freshly passed. |
| Wire/raw measurements | `frontend/tests/backend-storage.test.mjs:187`, `:239`, `:254`, `:266`, `:726` | Numeric/string exporter compatibility, bounded gzip, chunk reconstruction, scoped paging. Freshly passed; no UI raw-measurement integration claimed. |
| Identity/SSE lifecycle | `frontend/tests/backend-storage.test.mjs:127`, `:580`, `:591`, `:612`, `:713`; `frontend/tests/ui-lifecycle.test.mjs:36`, `:51`, `:66`, `:80`, `:95`, `:106`, `:265`, `:284`, `:300` | Ambiguity, tester pinning, cursor scope, cancellation, reconnect, late-response isolation and restored-source validation. Freshly passed. No automatic run discovery tested or implemented. |
| Replay/source state | `frontend/tests/seed.test.mjs:12`, `:33`, `:38`; `frontend/tests/source-session.test.mjs:9`, `:19`, `:26` | 24 complete seed joins, rejects live/wrong scope, ACK checks, import persistence and denied storage. Freshly passed. |
| Commands | `frontend/tests/backend-storage.test.mjs:203`, `:306`, `:350`, `:364`, `:389`, `:421`, `:435`, `:461` | Backend transitions, expiry, concurrency, rollback and supplied receipt provenance. Freshly passed; not real tester execution. |

Additional **existing tests inspected, not rerun** in this audit:

* `grp6_app/tests/test_exporter.py:52`, `:67`, `:82`, `:104`, `:120`, `:150`, `:158`, `:180`, `:208` cover partial/malformed ACK, quarantine/split/retry, stable restart identity, copied data and rollback. `:271`, `:285`, `:301`, `:325` use local transport for lost ACK, restart recovery, nonblocking submission and redirect rejection. These are current-source tests, not assertions about the pinned bundle.
* `grp6_app/tests/test_monitor.py:66`, `:281`, `:301`, `:315`, `:350` cover raw bundle fields, matching export identities, exporter failure isolation, disabled-export getters and independent tester runs.
* `grp6_app/tests/test_preview_seed.py:31`, `:47`, `:55`, `:64` cover deterministic scoped seed, causality and missing/ineligible inputs.

## Parent handoff

Final parent update: a fresh remote run completed 80 devices, 74 pass / 6 fail, and the parent is starting a repeat for complete capture. This is parent-reported tester execution, not evidence that these records reached the backend. No generated run ID, exporter ACK or matching new DB scope was supplied to this local audit.

**Repair prerequisites, without deployment:** (1) inspect actual pinned-container exporter/Monitor bytes or an exact image manifest; the absent export URL is confirmed, but absence of exporter code is not; (2) distinguish an older bundle with no exporter from alert-fix-era optional export with shallow copy/random retry batches/no ACK validation, and from current hardened source; (3) establish the intended HTTPS endpoint, matching ingest token, edge ID and persistent SQLite mount; (4) check container TLS/DNS/proxy and payload-size compatibility; (5) require correlated original-event ACK/storage evidence before labeling the UI live. None of these prerequisites authorizes this auditor to configure or deploy anything.

The parent has already resolved the two most immediate environmental questions: **only replay is stored, and live exporter configuration is absent**. This audit adds the precise source path and separates enabled transport from the additional product gaps. Remaining parent evidence should identify the actual Edge image/exporter implementation and correlate authorized future live delivery under its generated run/tester, preserving the distinction between source event, raw log sequence, projected record and tester receipt.

The local audit does not certify actual-container exporter contents, a new live lot, hosted concurrency, real tester receipt/display, paid-model operation or complete live-report acceptance. No remote action is needed to finish this local report.
