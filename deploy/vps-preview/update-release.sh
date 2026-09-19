#!/usr/bin/env bash
# Root-only entry point. Input comes from publish.ps1's committed git archive.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
base=/opt/grp6-preview
archive=${1:?Usage: update-release ARCHIVE FULL_GIT_SHA ARCHIVE_SHA256}
revision=${2:?Missing commit SHA}
checksum=${3:?Missing archive SHA256}
[[ $revision =~ ^[0-9a-f]{40}$ && $checksum =~ ^[0-9a-f]{64}$ ]] || exit 2
[[ $(realpath -- "$archive") == "$base/incoming/"* ]] || { echo 'Archive must be in incoming.' >&2; exit 2; }
exec 9>"$base/update.lock"
flock -n 9 || { echo 'Another preview update is running.' >&2; exit 1; }
printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
release=$(mktemp -d "$base/releases/$revision-XXXXXXXX")
tar -xzf "$archive" -C "$release" --no-same-owner
[[ -f $release/frontend/package-lock.json && -f $release/results/replay/replay.jsonl ]] || exit 2
printf '%s\n' "$revision" > "$release/REVISION"
chown -R grp6-preview:grp6-preview "$release"
chmod 0755 "$release"
export PATH="$base/node/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME="$base/shared/home"
export CI=true CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false
run_app() { runuser -u grp6-preview -- env PATH="$PATH" HOME="$HOME" CI=true CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false MINIFLARE_WORKERD_PATH="$base/bin/workerd-compat" GRP6_WORKERD_BINARY="$release/frontend/node_modules/@cloudflare/workerd-linux-64/bin/workerd" "$@"; }
cd "$release/frontend"
# Build before touching the currently running service or its database.
run_app npm ci --no-audit --no-fund
run_app npm run build
[[ -f dist/server/wrangler.json ]]
ln -s "$base/shared/.dev.vars" .dev.vars
ln -s "$base/shared/.dev.vars" dist/server/.dev.vars
mkdir -p .wrangler
[[ ! -e .wrangler/state ]] || { echo 'Unexpected build-time D1 state.' >&2; exit 1; }
ln -s "$base/shared/state" .wrangler/state
old=
if [[ -L $base/current && -d $base/current ]]; then old=$(readlink -f "$base/current"); fi
backup=$(mktemp -d "$base/backups/before-$revision-XXXXXXXX")
activated=0
stopped=0
rollback() {
  status=$?
  trap - ERR
  if (( activated )); then
    systemctl stop grp6-preview.service || true
    if [[ -e $base/shared/state ]]; then mv "$base/shared/state" "$backup/failed-state"; fi
    if [[ -d $backup/state ]]; then cp -a "$backup/state" "$base/shared/state"; fi
    if [[ -n $old && -d $old ]]; then
      ln -sfn "$old" "$base/current.rollback"
      mv -Tf "$base/current.rollback" "$base/current"
      systemctl start grp6-preview.service || true
    fi
    echo "Update failed; previous release/state restored. Evidence: $backup" >&2
  elif (( stopped )) && [[ -n $old && -d $old ]]; then
    # A failed backup is incomplete: preserve the original database untouched.
    systemctl start grp6-preview.service || true
    echo "Backup failed; original release/state retained and service restarted. Evidence: $backup" >&2
  fi
  exit "$status"
}
trap rollback ERR
systemctl stop grp6-preview.service
stopped=1
if [[ -d $base/shared/state ]]; then cp -a "$base/shared/state" "$backup/state"; fi
activated=1
install -d -o grp6-preview -g grp6-preview -m 0750 "$base/shared/state"
run_app node scripts/local-backend.mjs migrate
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl start grp6-preview.service
healthy=0
for attempt in {1..60}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:5173/api/config > "$backup/config.json"; then healthy=1; break; fi
  sleep 1
done
[[ $healthy == 1 ]]
node -e 'const c=require(process.argv[1]);if(!c.backend_connected || c.openai_configured) process.exit(1)' "$backup/config.json"
run_app node scripts/local-backend.mjs seed
curl --fail --silent --max-time 15 http://127.0.0.1:5173/ > "$backup/home.html"
curl --fail --silent --max-time 15 http://127.0.0.1:5173/replay > "$backup/replay.html"
curl --fail --silent --max-time 15 'http://127.0.0.1:5173/api/v1/runs/grp6-replay-demo?tester_id=grp6-replay' > "$backup/snapshot.json"
node -e 'const s=require(process.argv[1]);if(s.run?.mode!=="replay" || !s.events?.length) process.exit(1); console.log("Replay snapshot: "+s.events.length+" events")' "$backup/snapshot.json"
if [[ -n $old && -d $old ]]; then ln -sfn "$old" "$base/previous"; fi
trap - ERR
echo "Deployed $revision at http://127.0.0.1:5173 (grp6-preview.service)"
if [[ -f $base/nginx-upstream ]]; then cat "$base/nginx-upstream"; fi
echo "Rollback evidence: $backup; previous release: ${old:-none}"
