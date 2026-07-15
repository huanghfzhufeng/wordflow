#!/usr/bin/env bash
set -euo pipefail

DB="${DB_PATH:-/var/lib/wordflow/wordflow.db}"
OUT="${BACKUP_DIR:-/var/lib/wordflow/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

if [[ ! -f "$DB" ]]; then
  echo "Database not found: $DB" >&2
  exit 1
fi

mkdir -p "$OUT"
STAMP="$(date +%F)"
DEST="$OUT/wordflow-$STAMP.db"

sqlite3 "$DB" ".backup '$DEST'"
find "$OUT" -name 'wordflow-*.db' -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true

echo "$(date '+%F %T') backup complete: $DEST ($(du -h "$DEST" | cut -f1))"

