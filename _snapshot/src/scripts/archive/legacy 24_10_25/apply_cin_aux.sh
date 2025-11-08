#!/usr/bin/env bash
# apply_cin_aux.sh — Apply CryptoPill CIN-AUX DDL pack to PostgreSQL
# Usage:
#   ./apply_cin_aux.sh [-f path/to/cin-aux-pack.sql]
#
# Connection:
#   - Prefer DATABASE_URL if set (postgres://user:pass@host:port/dbname)
#   - Otherwise use PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#
# Safety:
#   - ON_ERROR_STOP=1 (fail fast)
#   - --single-transaction (all-or-nothing)
#   - Sets a generous statement_timeout to avoid accidental long locks

set -euo pipefail

PACK_FILE="cin-aux-pack.sql"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      PACK_FILE="$2"
      shift 2
      ;;
    -h|--help)
      grep -E '^(# |Usage:|#   - )' "$0" | sed 's/^# \\?//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql not found in PATH." >&2
  exit 127
fi

if [[ ! -f "$PACK_FILE" ]]; then
  echo "Error: SQL pack not found: $PACK_FILE" >&2
  exit 2
fi

# Make psql stop on first error
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

# Common psql flags
PSQL_FLAGS=(
  -v ON_ERROR_STOP=1
  --single-transaction
  --file "$PACK_FILE"
)

echo "==> Applying $PACK_FILE"
if [[ -n "${DATABASE_URL:-}" ]]; then
  # Use connection string
  psql "${PSQL_FLAGS[@]}" "$DATABASE_URL"
else
  # Use discrete PG* variables; require at least a database name
  if [[ -z "${PGDATABASE:-}" ]]; then
    echo "Error: set DATABASE_URL or PGDATABASE/PGHOST/PGUSER/etc." >&2
    exit 3
  fi
  psql "${PSQL_FLAGS[@]}"
fi

echo "==> Done."
