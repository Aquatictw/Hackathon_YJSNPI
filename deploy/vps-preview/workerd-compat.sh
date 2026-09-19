#!/usr/bin/env bash
set -Eeuo pipefail
# This VPS exposes a legacy QEMU CPU without the instructions workerd needs.
# Scope userspace emulation to workerd; Node and the build remain native.
binary=${GRP6_WORKERD_BINARY:?Missing workerd executable path}
exec /usr/bin/qemu-x86_64 -cpu max "$binary" "$@"
