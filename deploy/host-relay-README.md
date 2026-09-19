# HC EdgeLog relay

This is an explicit **host log bridge**: host `Edge/EdgeLog/EdgeLog log` → private host SQLite ledger → existing HTTPS `/api/v1/events/batch`. It requires Python 3.6+ and its standard library. It does not install anything into Edge, use container mounts, execute tester commands, or call a model API. Transfer, activation and permitted data export remain A's integration responsibilities.

## Package and transfer

The complete runtime is `deploy/host_relay.py`. Include this README and `deploy/tests/test_host_relay.py` for review and offline verification; preserve their relative paths. No runtime app, model artifacts, SDK, node dependencies, logs, ledger or private configuration belong in this bundle. Do not run the normal Edge image installer for this relay.

From the repository root, A can create a **new** archive (exclusive creation; existing files are not replaced):

```powershell
python -B -c "import zipfile; z=zipfile.ZipFile('grp6-host-relay.zip','x',zipfile.ZIP_DEFLATED); [z.write(p,p) for p in ['deploy/host_relay.py','deploy/tests/test_host_relay.py','deploy/host-relay-README.md']]; z.close()"
Get-FileHash grp6-host-relay.zip -Algorithm SHA256
(Get-Item grp6-host-relay.zip).Length
```

After the authorized transfer to a fresh host directory, compare `sha256sum` and byte size against A's local values, run `unzip -tq`, and extract there. From that extracted directory:

```sh
python3 -B -m unittest discover -s deploy/tests -p test_host_relay.py -v
python3 -B deploy/host_relay.py --help
```

The test suite uses temporary local files, subprocesses and mocked network responses; it does not contact the website or machine. The source is Python 3.6 compatible, including ISO timestamp parsing without `datetime.fromisoformat`. Local validation passed all 28 tests on Linux/WSL and 27 on Windows Python 3.12 (the POSIX permissions test is skipped there), plus the Python 3.6 grammar check; actual HC Python 3.6 execution remains an activation check.

## Private setup on the Linux host

1. Select an absolute host directory that A has verified survives the expected host/release lifecycle. Keep it outside Edge, transient extraction directories and `/tmp`. Example:

   ```sh
   umask 077
   mkdir -p /home/user/grp6-host-relay-state
   chmod 700 /home/user/grp6-host-relay-state
   ```

2. Create an owner-controlled private JSON file through the approved private transfer/editor workflow. Required shape (placeholder only):

   ```json
   {
     "endpoint": "https://hackathon.aquatictw.com/api/v1/events/batch",
     "token": "REPLACE_PRIVATELY_WITH_INGEST_TOKEN",
     "edge_id": "grp6-hc-relay"
   }
   ```

   Set its mode to `0600` and owner to the account running the relay. For example, use `/home/user/.config/grp6-host-relay.json` in a private parent directory. Do not paste the real token into shell commands, logs, screenshots, this README, or Git. The CLI accepts only its file path. Group/world access, symlinks, non-owned files, HTTP, URL credentials, query strings, fragments and a different route are rejected. Sending requires a POSIX host because Windows mode bits do not establish private ACLs. TLS certificate verification is enabled; redirects and environment proxy routing are disabled.

   ```sh
   chmod 600 /home/user/.config/grp6-host-relay.json
   ```

3. Collect one host poll without network:

   ```sh
   python3 -B deploy/host_relay.py \
     --state-dir /home/user/grp6-host-relay-state --once
   ```

   The default executable is `/home/user/Case_Event/Edge/EdgeLog/EdgeLog` and its sole argument is `log`. Override the executable with `--edgelog /verified/path/EdgeLog` if needed. No shell is involved. Default timeout is ten seconds; complete lines emitted before timeout/nonzero exit are retained and processed. Partial JSON stays in the captured bytes and issues table. Unscoped records such as `monitor_start` are retained as issues, with no invented tester ID.

4. After A's activation decision, start the foreground bridge with HTTPS enabled:

   ```sh
   python3 -B deploy/host_relay.py \
     --state-dir /home/user/grp6-host-relay-state \
     --send --config /home/user/.config/grp6-host-relay.json
   ```

   Ctrl-C stops it. Relaunch with the same state directory to resume. It sleeps five seconds between cycles; subprocess/HTTPS work adds to the interval. Each cycle has a bounded send-attempt count and starts no additional requests after its send budget. An individual HTTP timeout is a socket timeout, not a total streaming-response deadline. Defaults: 25 events per batch, at most ten requests per cycle, ten-second HTTP timeout. There is no installed service or unattended startup. Polling requires the host session/process to remain running; log rotation can lose records before the next successful capture.

For a previously collected host ledger, retry without invoking EdgeLog:

```sh
python3 -B deploy/host_relay.py \
  --state-dir /home/user/grp6-host-relay-state --drain \
  --send --config /home/user/.config/grp6-host-relay.json
```

Add `--once` for one bounded cycle; pending/backoff work can remain afterward. Configuration may rotate the token, but a ledger's endpoint, edge identity and poll/recorded mode cannot silently change. If using a custom edge ID, pass the same `--edge-id` during offline collection; sending reads it from the private config.

## Saved captures are recorded/replay

Use a **separate state directory** for imports. Both prefixed EdgeLog captures and bare raw-monitor JSONL are accepted. Import alone is offline:

```sh
python3 -B deploy/host_relay.py \
  --state-dir /home/user/grp6-recorded-relay-state \
  --capture /approved/path/saved-edgelog.log
```

For an authorized recorded upload, use the same command with `--send --config /private/config.json`. An import performs one bounded cycle, even without `--once`. Drain remaining batches using `--drain --recorded-ledger --send --config /private/config.json` and that same recorded state directory.

All imported events have operational `mode/source_mode=replay`. Their original source label, exact ISO timestamp and all fields remain in `raw_record`; the original capture bytes remain in SQLite. IDs are never regenerated. Consequently an event already stored as live on the same backend can correctly conflict with its recorded/replay import; do not change IDs or use another edge ID to disguise that conflict. A must select the intended import destination/workflow.

## Integrity and source meaning

- Each capture's original bytes, valid mapped records, and malformed/conflicting-line references commit atomically before any network operation. SQLite uses WAL and `synchronous=FULL`. Original records, outbound payloads, frozen batch membership, attempts, backoff and successful ACKs survive process restart. The CLI holds an exclusive host lock for its state directory. This does not prove host disk durability or guarantee collection before a machine log rotates.
- Deduplication keys are the original `(run_id, tester, event_id)`. Identical overlapping polls and restarts do not resend delivered records. Different content under one key preserves both captures, marks the record as conflicted, and blocks any pending batch containing it. Other unassigned records may continue. IDs repeated across different scopes are placed in separate batches because ACK lists contain bare event IDs.
- The batch ID hashes its exact event content, order and edge identity. Frozen membership is never modified on retry. Delivery requires the exact matching batch ID and a disjoint, duplicate-free `accepted + duplicates` set equal to every submitted ID, with `rejected=[]`. Missing/malformed/partial/rejected ACKs retire **nothing**. A server may already have accepted part of a failed attempt; its eventual exact duplicate ACK is required. HTTP/auth/conflict/validation/outage failures stay pending, with 5–300 second exponential backoff. Requests are capped at 3 MiB and ACK reads at 256 KiB; an oversized individual event stays retained as `oversized`.
- Direct polling preserves source-reported `live/replay/simulation` and original source times. **The first poll can contain retained history marked live; that label does not prove current connectivity.** No current timestamp, fake heartbeat, measurement bundle, tester receipt or prediction is manufactured. Backend/UI freshness must use the original source timestamp and distinguish source mode from stream/connection state. `host_relay` provenance explicitly identifies the bridge and `source_time_only` freshness. Backend arrival/SSE time is not machine freshness.
- Raw prediction requests/actuals preserve per-site IDs and maps for the existing backend projector. Sampled measurements remain sampled raw records, not fabricated complete device bundles. Unknown scope/time is retained locally, never inferred from another event. Exporter parsing and backend projection still govern acceptance; native exporter records with the same source IDs but different payloads can conflict, so A must coordinate any native-exporter cutover.

## Status and recovery

ACK status must be exactly `stored` or `duplicate`; missing/unknown status fails closed. A `duplicate` ACK cannot include newly accepted IDs. Tests cover these cases alongside missing, overlapping, foreign and rejected ACK IDs.

Console output contains counts and fixed status codes only; it omits raw records, tokens, URLs, paths and HTTP error bodies. A successful batch is an ingest ACK, not proof of UI freshness, tester delivery, model access or a native Edge connection.

Exit codes: `0` = requested one-shot work completed (offline pending records are expected); `1` = retained issues, command failure, or send-mode work still pending/conflicted/oversized; `2` = CLI/configuration/storage failure; `130` = Ctrl-C. Expected unscoped startup records therefore make one-shot imports return 1 even when every valid scoped record is processed. Continuous mode reports issues and keeps collecting.

Private ledger tables: `captures` (exact bytes and initial capture metadata), `records` (canonical raw/outbound event and state), `issues` (capture hash/line/reason), `batches` (frozen payload/backoff/ACK), `batch_items` and `meta`. Inspect locally with SQLite/Python. Do not export raw contents into public logs. A storage failure exits before sending newly captured data; uncommitted bytes may need recollection from EdgeLog.

Stop the relay before a consistent SQLite backup, or use SQLite's backup API; copying only a live `.sqlite3` file can omit WAL data. Keep the state directory across code updates. There is no automatic pruning, conflict rewriting, schema migration or operator repair/requeue command. Capture/ledger growth and available disk space require host monitoring. Resolve retained conflicts/rejections with A while preserving originals; never delete the ledger to make counters look clean.

Before claiming activated transport, A must verify original event IDs and timestamps across the host ledger, HTTPS ACK, backend snapshot/raw payload and UI, then exercise outage/restart recovery. Historical-record freshness must remain visibly distinct. These checks are separate from the offline implementation tests.
