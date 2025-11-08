#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "== 1) Settings: show universe =="
curl -sS "${BASE_URL}/api/settings/universe" | jq -r '.' || true
echo

echo "== 2) Market: sync symbols from settings (calls market.sp_sync_from_settings_universe) =="
# If you don't have this route yet, expose one that executes the function server-side.
curl -sS -X POST "${BASE_URL}/api/market/symbols/sync" | jq -r '.' || true
echo

echo "== 3) Market: list symbols =="
curl -sS "${BASE_URL}/api/market/symbols" | jq -r '.' || true
echo

echo "== 4) Market: fetch raw klines from provider (no DB write) =="
curl -sS "${BASE_URL}/api/market/klines?symbol=BTCUSDT&interval=1m&limit=60" | jq -r '.' || true
echo

echo "== 5) Market: ingest klines into DB (writes via sp_ingest_kline_row) =="
curl -sS "${BASE_URL}/api/market/ingest/klines?wins=1m,5m,15m&limit=60" | jq -r '.' || true
echo

echo "== 6) Matrices: compute benchmark + delta (aligned with matrices.*) =="
curl -sS "${BASE_URL}/api/matrices?window=30m&quote=USDT" | jq -r '. | {ok, n_symbols: (.symbols|length), sample: .symbols[0:5]}' || true
echo

echo "== 7) STR-AUX vectors: compute (stateless) =="
curl -sS "${BASE_URL}/api/str-aux/vectors?window=30m&bins=128&scale=100&cycles=2&force=true" | jq -r '. | {symbols: (keys|length), sample: (to_entries[0:2])}' || true
echo

echo "== 8) STR-AUX vectors: with synthetic inline series for BTCUSDT =="
curl -sS "${BASE_URL}/api/str-aux/vectors?symbols=BTCUSDT&series_BTCUSDT=100,101,103,102,104" | jq -r '.' || true
echo

echo "Done."
