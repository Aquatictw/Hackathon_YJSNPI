#!/usr/bin/env bash
# Integration check on the dedicated preview only. Causes two brief restarts.
set -Eeuo pipefail
[[ $EUID == 0 ]]
base=/opt/grp6-preview
revision=$(cat "$base/current/REVISION")
archive="$base/incoming/$revision.tar.gz"
checksum=$(sha256sum "$archive" | cut -d ' ' -f 1)
evidence=$(mktemp -d "$base/backups/recovery-check-XXXXXXXX")
snapshot='http://127.0.0.1:5173/api/v1/runs/grp6-replay-demo?tester_id=grp6-replay'
old=$(readlink -f "$base/current")
curl --fail --silent --max-time 15 "$snapshot" > "$evidence/before.json"
for mode in backup activation; do
  # Copy the installed script and inject one failure into its real recovery path.
  # The installed updater and app sources remain unchanged.
  python3 - "$base/bin/update-release" "$evidence/$mode.sh" "$mode" <<'PY'
from pathlib import Path
import sys
source, destination, mode = sys.argv[1:]
text = Path(source).read_text()
if mode == 'backup':
    old = 'then cp -a "$base/shared/state" "$backup/state"; fi'
    new = 'then mkdir "$backup/state"; echo partial > "$backup/state/INCOMPLETE"; false; fi'
else:
    old = '[[ $healthy == 1 ]]'
    new = 'false # intentional activation failure for rollback integration check'
assert text.count(old) == 1, 'Updater changed; inspect injection point first'
Path(destination).write_text(text.replace(old, new))
PY
  set +e
  bash "$evidence/$mode.sh" "$archive" "$revision" "$checksum" > "$evidence/$mode.log" 2>&1
  result=$?
  set -e
  [[ $result != 0 ]]
  [[ $(readlink -f "$base/current") == "$old" ]]
  ready=0
  for attempt in {1..60}; do
    if curl --fail --silent --max-time 3 "$snapshot" > "$evidence/$mode.json"; then ready=1; break; fi
    sleep 1
  done
  [[ $ready == 1 ]]
  cmp "$evidence/before.json" "$evidence/$mode.json"
  systemctl is-active --quiet grp6-preview.service
  echo "PASS $mode failure: previous release restored/running, snapshot unchanged"
done
echo "Recovery evidence: $evidence"
