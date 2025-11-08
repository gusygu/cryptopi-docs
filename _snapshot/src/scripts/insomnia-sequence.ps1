
param(
  [string]$BaseUrl = "http://localhost:3000"
)

function Get-Json($url) {
  try {
    $resp = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 60
    return $resp
  } catch {
    Write-Warning "GET $url failed: $($_.Exception.Message)"
  }
}

function Post-Json($url, $body = $null) {
  try {
    if ($null -ne $body) {
      $resp = Invoke-RestMethod -Uri $url -Method POST -Body ($body | ConvertTo-Json -Depth 6) -ContentType "application/json" -TimeoutSec 60
    } else {
      $resp = Invoke-RestMethod -Uri $url -Method POST -TimeoutSec 60
    }
    return $resp
  } catch {
    Write-Warning "POST $url failed: $($_.Exception.Message)"
  }
}

Write-Host "== 1) Settings: show universe ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/settings/universe" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 2) Market: sync symbols from settings ==" -ForegroundColor Cyan
Post-Json "$BaseUrl/api/market/symbols/sync" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 3) Market: list symbols ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/market/symbols" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 4) Market: fetch raw klines (BTCUSDT 1m x60) ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/market/klines?symbol=BTCUSDT&interval=1m&limit=60" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 5) Market: ingest klines (1m,5m,15m x60) ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/market/ingest/klines?wins=1m,5m,15m&limit=60" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 6) Matrices: benchmark/delta (30m, USDT) ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/matrices?window=30m&quote=USDT" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 7) STR-AUX vectors (stateless compute) ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/str-aux/vectors?window=30m&bins=128&scale=100&cycles=2&force=true" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "== 8) STR-AUX vectors with synthetic BTCUSDT series ==" -ForegroundColor Cyan
Get-Json "$BaseUrl/api/str-aux/vectors?symbols=BTCUSDT&series_BTCUSDT=100,101,103,102,104" | ConvertTo-Json -Depth 6
Write-Host ""

Write-Host "Done." -ForegroundColor Green
