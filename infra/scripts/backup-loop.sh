#!/bin/sh
# Nightly logical backup of the game database (runs inside the "backup" container).
set -eu
while true; do
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  file="/backups/startup-$ts.dump"
  if pg_dump -h db -U startup -d startup -Fc -f "$file.partial"; then
    mv "$file.partial" "$file"
    echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"
  else
    echo "[backup] FAILED at $ts" >&2
    rm -f "$file.partial"
  fi
  find /backups -name 'startup-*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
  sleep 86400
done
