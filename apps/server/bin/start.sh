#!/bin/sh
# V8 cannot see the container's memory limit. Left alone it sizes the old space from the
# host's RAM — on a shared host that is tens of gigabytes — so under load it grows past what
# the platform allows and the process is killed instead of collecting. Read the cgroup limit
# and hand V8 a little under half of it, leaving room for SQLite, libvips and the native side.
set -e

limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "")

case "$limit" in
  '' | max | *[!0-9]*) heap_mb=256 ;;
  *) heap_mb=$((limit / 1048576 * 45 / 100)) ;;
esac

# An unset limit is often reported as the host's entire memory; clamp both ends.
[ "$heap_mb" -gt 1024 ] && heap_mb=1024
[ "$heap_mb" -lt 128 ] && heap_mb=128

echo "[boot] container memory limit ${limit:-unset}, V8 old space capped at ${heap_mb}MB"
exec node --max-old-space-size="$heap_mb" apps/server/dist/index.js
