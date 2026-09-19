#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
base=/opt/grp6-preview
here=$(cd -- "$(dirname -- "$0")" && pwd)
if ! id grp6-preview >/dev/null 2>&1; then
  useradd --system --home-dir "$base/shared/home" --shell /usr/sbin/nologin grp6-preview
fi
install -d -m 0755 "$base" "$base/releases" "$base/backups" "$base/incoming" "$base/bin"
install -d -o grp6-preview -g grp6-preview -m 0750 "$base/shared" "$base/shared/home" "$base/shared/runtime"
if [[ ! -x $base/node/bin/node ]]; then
  node_version=v22.18.0
  stage=$(mktemp -d "$base/incoming/node.XXXXXXXX")
  (
    cd "$stage"
    curl --fail --silent --show-error --location --max-time 180 -O "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz"
    curl --fail --silent --show-error --location --max-time 60 -O "https://nodejs.org/dist/$node_version/SHASUMS256.txt"
    grep "  node-$node_version-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
    tar -xJf "node-$node_version-linux-x64.tar.xz"
    mv "node-$node_version-linux-x64" "$base/node"
  )
fi
if [[ ! -f $base/shared/.dev.vars ]]; then
  umask 027
  printf 'INGEST_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$base/shared/.dev.vars"
  chown root:grp6-preview "$base/shared/.dev.vars"
  chmod 0640 "$base/shared/.dev.vars"
fi
install -m 0755 "$here/update-release.sh" "$base/bin/update-release"
command -v qemu-x86_64 >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y qemu-user
install -m 0755 "$here/workerd-compat.sh" "$base/bin/workerd-compat"
install -m 0644 "$here/grp6-preview.service" /etc/systemd/system/grp6-preview.service
systemctl daemon-reload
systemctl enable grp6-preview.service
"$base/node/bin/node" --version
echo 'Bootstrap ready; publish a committed source archive to activate.'
