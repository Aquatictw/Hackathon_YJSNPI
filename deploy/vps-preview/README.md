# VPS development preview

This folder implements the explicitly authorized preview on `root@103.27.132.88`.
It is separate from the grp6 competition machines. Current project acceptance
still belongs in `SYSTEM.md`; this is the deployment procedure.

The app listens on **127.0.0.1:5173**. The existing nginx Proxy Manager runs in
Docker, so its verified upstream is **http://172.23.0.1:5173** (HTTP, port 5173).
`docker inspect nginx-app-1` identified `172.23.0.12` on `web_apps`, gateway
`172.23.0.1`, network ID `97e6e7626cfba62b613ef0707cb1c9f5ffcc880f918b077ec3e052a94fc58876`.
The gateway socket forwards to localhost; UFW allows TCP 5173 only from
`172.23.0.0/16` on `br-97e6e7626cfb` to `172.23.0.1`. Nothing listens on the
public interface at this port. No existing nginx configuration was modified.
`install-docker-upstream.sh` rediscovers and verifies this gateway/bridge before
installing; rerun and review it if the Docker network is recreated.

For streaming through nginx, disable response buffering and allow long requests:

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
```

Open `/` and click **載入批次** with the prefilled `grp6-replay-demo` /
`grp6-replay`; `/replay` also works. Data is explicitly labeled replay. No
OpenAI or command token is installed. Public user authentication is not
implemented by this app; nginx access controls remain the user's configuration.
The public preview is https://hackathon.aquatictw.com/. The prediction seed
contains the first device at each of four sites from W01, six stages each,
with matching actuals and selected measurement samples. These are fitted-data
replay examples, not accuracy validation or tester execution. Regenerate with
`python -m grp6_app.preview_seed source_review/training/Data/A12345_W01_RawResult.csv`.
Commit the JSONL and provenance together. IDs depend on source/model/manifest
hashes; exact updates are idempotent. Existing alert IDs are immutable: changing
the alert replay requires A to version its run identity before reseeding.

## Update from this Windows checkout

After the desired code is published to main, run:

```powershell
& ./deploy/vps-preview/publish.ps1
```

The default fetches `origin/main`, archives only committed `frontend/` and the
replay seed, uploads using the existing SSH key, verifies the archive SHA256,
and builds/activates on the VPS. It never copies ignored secrets or private keys
and never pushes Git. The VPS cannot read this private repository, so local
publishing avoids installing GitHub credentials there. For a known published
revision already fetched locally, use `-Ref <SHA> -SkipFetch`. The helper
requires that revision to be an ancestor of the local `origin/main`.

## Runtime and recovery

- Service: `grp6-preview.service`, enabled at boot, runs as system user
  `grp6-preview`; the private bridge uses `grp6-preview-docker.socket/service`.
- Releases: `/opt/grp6-preview/releases/<SHA>-<unique suffix>`. `current` is an
  atomic symlink; `previous` points to the preceding successfully active release.
- Persistent local D1: `/opt/grp6-preview/shared/state`. Secrets:
  `/opt/grp6-preview/shared/.dev.vars` (root/preview group, mode 0640). The
  generated ingest token is local to this preview. Both paths survive releases.
- Node 22.18.0 is isolated in `/opt/grp6-preview/node`, verified against the
  Node distribution SHA256; the existing global Node 20 is unchanged. This VPS
  exposes an old QEMU CPU: native workerd could not start even a minimal worker.
  `workerd-compat.sh` runs only workerd with `qemu-x86_64 -cpu max`; Node/builds
  stay native. This is a preview workaround with slower startup/requests.
- Updates install lockfile dependencies and build before stopping the service.
  With the service stopped, they copy the complete D1 directory to a new backup,
  apply local migrations, switch the symlink, start, seed idempotently and check
  homepage/replay/config/snapshot. A failed backup restarts the old service
  without touching original state; later failure restores both old release and
  the complete pre-migration state. Failed state is retained for diagnosis.

Backups and releases are retained under `/opt/grp6-preview/backups` and
`releases`; inspect disk usage when retiring old development revisions.
Each successful update prints the backup and old release paths. Updates
briefly interrupt the preview while state is backed up and migrations run.

Useful VPS commands:

```bash
systemctl status grp6-preview --no-pager
journalctl -u grp6-preview -n 40 --no-pager
cat /opt/grp6-preview/current/REVISION
cat /opt/grp6-preview/nginx-upstream
```

`bootstrap.sh` installs the isolated runtime/user/service and updater from this
folder. `verify-http.mjs` checks HTML, built assets, replay, config, persisted
snapshot and SSE. `verify-recovery.sh` exercises the actual updater's backup
and activation failure paths using temporary copies with injected failures; it
causes two intentional preview interruptions and checks the old snapshot and
release after each. It does not alter the installed updater or application
source. Deployment evidence is in `verification.json`.
