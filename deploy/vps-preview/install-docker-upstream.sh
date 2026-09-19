#!/usr/bin/env bash
set -Eeuo pipefail
# Bind only the existing nginx Docker bridge, never the public interface.
[[ $EUID == 0 ]]
gateway=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' nginx-app-1)
[[ $gateway == 172.23.0.1 ]] || { echo 'nginx Docker gateway changed; inspect before installing.' >&2; exit 1; }
network_id=$(docker network inspect web_apps --format '{{.Id}}')
bridge=br-${network_id:0:12}
ip -4 addr show "$bridge" | grep -q '172.23.0.1/16'
cat > /etc/systemd/system/grp6-preview-docker.socket <<'UNIT'
[Unit]
Description=Private Docker nginx upstream for grp6 preview
After=docker.service
Requires=docker.service

[Socket]
ListenStream=172.23.0.1:5173
NoDelay=true

[Install]
WantedBy=sockets.target
UNIT
cat > /etc/systemd/system/grp6-preview-docker.service <<'UNIT'
[Unit]
Description=Forward private Docker preview requests to localhost
Requires=grp6-preview.service
After=grp6-preview.service

[Service]
ExecStart=/lib/systemd/systemd-socket-proxyd 127.0.0.1:5173
DynamicUser=true
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UNIT
systemctl daemon-reload
systemctl enable --now grp6-preview-docker.socket
if ufw status | grep -q '^Status: active'; then
  ufw allow in on "$bridge" from 172.23.0.0/16 to 172.23.0.1 port 5173 proto tcp comment 'grp6 preview from nginx Docker network'
fi
docker exec nginx-app-1 curl --fail --silent --max-time 15 http://172.23.0.1:5173/api/config
printf 'nginx container upstream: http://%s:5173\n' "$gateway" > /opt/grp6-preview/nginx-upstream
