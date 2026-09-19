# Exporter release preparation — continuation 20260920

Prepared for coordinating A from local HEAD `63d5d1d61f926563953e0dabbe5423dda8c6265f`. Status: local preparation and tests complete; live activation remains blocked on the Edge storage/transport checks below. This is a scoped handoff, not a replacement for SYSTEM.md or evidence of deployment.

Only `deploy/package_grp6.py`, `deploy/install_grp6.py`, `deploy/tests/test_release.py` and this report were authored. No exporter, Monitor, frontend, SYSTEM, descriptor or model files were edited. No remote/browser access, deployment, Git mutation, W2/W25 research or candidate promotion occurred. Existing unrelated `.claude/` content was preserved. Temporary test bundles were removed automatically; no new release ZIP is claimed as a retained deliverable.

## Findings and implemented safeguards

- The former packager globbed every artifact JSON, including the unaccepted `sparse_burst.json`. Packaging now allows only `runtime.json`, `manifest.json` and `validation.json`, and refuses a runtime model different from recorded production SHA256 `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`. There is deliberately no candidate-enable or model-override flag. New archive paths must be unused.
- Current `runtime.py` imports `sparse_burst.py`, so that Python dependency remains in the bundle. Its calibration artifact is absent; the extracted runtime reports `calibration_missing`, its calibration is `None`, and its supplementary analysis returns no alerts. This retains the existing active core model/detector policy; it does not claim byte-identical detector source to the old deployed image. No calibration/retraining/replay regeneration was performed.
- Installation verifies checksums and exact manifested runtime contents, rejects traversal/symlinks, extra candidate artifacts and changed model bytes, and excludes an old `grp6_app` tree from copied SDK inputs. The supplied SDK/native wrappers remain intact. Container smoke checks additionally require the accepted model hash, absent calibration and disabled supplement before push.
- Optional descriptor preparation reads a separate owner-only JSON environment file, validates HTTPS/auth/path/limits, and writes a fresh owner-only descriptor **outside** release/SDK/build inputs. It preserves unrelated fields, containers and existing storage configuration, pins the image, replaces only exporter settings, and never applies the descriptor. Secrets are absent from command arguments, image build inputs, deployment records and installer output. Live descriptors themselves necessarily contain the token; protect them and their backups. The code has no token-file support because the unchanged exporter reads `GRP6_EXPORT_TOKEN` directly from the container environment.
- Installer push now publishes only the unique versioned tag; it does not retag or push `latest`. Records distinguish built/pushed/descriptor-prepared from deployed (always false here) and include the exporter SHA. Unit/SDK smoke containers explicitly disable exporting. Microsecond UTC release identifiers reduce staging/tag collisions.

Reviewed exporter source SHA256: `98ec179227496ccd27f18f9ea629077e9fa1cec966d62f0cced4ae10c0797657`. The release copies these source bytes rather than the historically deployed older exporter. A should verify the fresh package manifest and final image; this report's hash is a working-tree observation.

The supplied `Case_Event/SmarTest/app_descriptor.json` proves an `edge.containers[]` entry named `py-app` with an `environment` object. Its local image is `grp6/py-app:latest`; this local file is not the remotely pinned descriptor. Read the actual current remote descriptor for preparation. No local source establishes the platform's persistent-volume schema. The helper therefore preserves unknown mount fields and does **not** invent Docker/Kubernetes fields. `--outbox-root` is an explicit operator assertion about an already verified container mount, not mount discovery or creation.

## Deployment approach for A

1. **Resolve the storage gate before live activation.** Identify the platform-supported persistent mount and verify its container path, source storage, application UID write permissions and survival across AppDeployer stop/purge/start and container replacement. The example below uses `/var/lib/grp6-export`; substitute a verified mount in both config and CLI. Merely creating a directory inside the container or setting an absolute path does not establish durability. Mount the whole directory: SQLite needs the database and adjacent `-wal`/`-shm` files. Keep it outside the application/artifact directory, do not share it between simultaneous exporters, and preserve it for rollback.
2. **Package and transfer an immutable release.** After A integrates the scoped changes, run the local command below with an unused destination. Record the printed archive size/SHA, have the user perform the competition-VM transfer, verify `group-6`, archive SHA/size and ZIP integrity, and extract to a fresh directory per SYSTEM. Do not add private config to that directory or archive.
3. **Provision runtime credentials privately.** Confirm the intended backend has the ingest route and migrated persistent DB. On group-6, obtain the matching backend `INGEST_TOKEN` through the approved private channel and write the private environment JSON outside the repository/release/SDK. The example uses a hidden prompt, not a token argument or shell-history literal. Use a stable live edge ID. Do not reuse the replay edge ID.
4. **Build, test, push and prepare a private descriptor.** Use the actual current descriptor as input and the installer command below. Inspect only redacted fields. Preserve build logs, image ID, registry digest and deployment record. After confirming readiness and backing up both descriptors securely, A applies the prepared content to both `/home/user/Case_Event/SmarTest/app_descriptor.json` and `/opt/acs/nexus/conf/app_descriptor.json`, with restrictive permissions that still allow the verified deployment consumer to read them. `runTp.sh` copies the former over the latter, so changing only the live copy is insufficient. The installer performs neither activation nor descriptor replacement.
5. **Activate and accept on the actual Edge.** Follow SYSTEM's bound/idle AppDeployer procedure; never restart Nexus during SmarTest. Verify the running container image/digest and model hash, disabled supplement, exporter environment presence without printing its token, real persistent mount, DNS/TLS and gzip ingest. Require identical original event IDs across Edge/outbox, committed backend records, snapshot and SSE. Exercise one bounded outage/lost-ACK/restart recovery and check duplicate handling, quarantine/storage-error counts and callback performance. Retain evidence and the previous pinned image/descriptors; rollback must preserve the outbox and avoid two active senders.

Local packaging command (destination must not exist):

```powershell
python -B deploy/package_grp6.py --output C:/Users/USER/Downloads/grp6_export_transport_20260920.zip
```

Private configuration creation on verified group-6, only after the mount path and target backend have been established (example paths are not proof that the mount exists):

```sh
python3 -B - <<'PY'
import getpass, json, os
from pathlib import Path
private = Path('/home/user/.config/grp6')
private.mkdir(mode=0o700, parents=True, exist_ok=True)
private.chmod(0o700)
token = getpass.getpass('Backend INGEST_TOKEN (hidden): ')
config = {
    'GRP6_EXPORT_URL': 'https://hackathon.aquatictw.com/api/v1/events/batch',
    'GRP6_EXPORT_TOKEN': token,
    'GRP6_EXPORT_OUTBOX': '/var/lib/grp6-export/outbox.sqlite3',
    'GRP6_EDGE_ID': 'grp6-edge',
    'GRP6_EXPORT_QUEUE': '32',
    'GRP6_EXPORT_BATCH': '1',
    'GRP6_EXPORT_TIMEOUT': '5'
}
fd = os.open(str(private / 'export-live.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump(config, output)
PY
```

Installer command on verified group-6; replace `/path/to/fresh-release` with the actual new extraction directory. The prepared descriptor destination must not already exist. Keep the source descriptor outside the release/SDK/build directories.

```sh
python3 -B /path/to/fresh-release/install_grp6.py \
  --case /home/user/Case_Event --build --push \
  --descriptor /home/user/Case_Event/SmarTest/app_descriptor.json \
  --export-config /home/user/.config/grp6/export-live.json \
  --descriptor-output /home/user/.config/grp6/app_descriptor.transport.json \
  --outbox-root /var/lib/grp6-export
```

All four descriptor options are required together. Omitting them retains ordinary export-disabled image preparation. With no build/push flag the installer only stages files; its record has `built=false` and `pushed=false`, so such an image must not be activated. `--push` includes build/tests/smoke. Descriptor preparation does not verify the backend, token validity or persistent mount. Never dump unredacted Docker environment inspection, descriptors, `.dev.vars` or private config into logs/reports/Git.

## Verification and limits

| Check | Result |
| --- | --- |
| `python -B -m unittest discover -s deploy/tests -v` | 12 tests passed on local Python 3.12.2. Covers artifact/model guards, immutable ZIP, extracted-runtime disablement, manifest traversal/checksums, config rejection without secret echo, descriptor preservation, exclusive private output and mocked installer build/test/smoke/push flow. |
| Fresh temporary package, verified extraction, then `python -B -m unittest discover -s grp6_app/tests -v` from that extraction | 51 packaged tests passed in 6.170 seconds, including 22 exporter tests with localhost ACK/outage/restart behavior. All Monitor fixtures use the accepted artifact with calibration absent. These are synthetic/local tests, not tester-run or live-transport evidence. |
| Host installer compatibility | Python 3.6 syntax parsed successfully; code retains Python 3.6 stdlib APIs. Actual host Python 3.6 and native SDK/Docker build were not executed. POSIX owner-only permissions still require host verification; local execution was Windows. |
| Whitespace and ownership | `git diff --check` passed. Changes confined to the four assigned paths; unrelated work preserved. |

Remaining activation blockers belong to A: platform-supported durable storage across purge/replacement; actual-container DNS/TLS/auth/gzip reachability and image identity; host SDK build and performance; original-ID DB/snapshot/SSE correlation and recovery. The historical host/VPS evidence does not close these gates. No live transport success is claimed.

Exporter operational limits remain unchanged: enqueue is bounded by event count and is not durable until worker COMMIT; a hard stop or disk failure before COMMIT can lose volatile events. SQLite/quarantine storage has no automatic size bound or repair/requeue CLI. Use disk monitoring and review retained quarantine; do not infer complete delivery from an empty queue or HTTP success without a valid matching ACK. Command polling/execution and the separate anomaly display failure are outside this preparation.

A owns any corresponding canonical SYSTEM/runbook update during integration, including versioned-only pushing, the artifact exclusion policy and private descriptor options. Next: establish the Edge persistent-mount mechanism before enabling the prepared exporter configuration.
