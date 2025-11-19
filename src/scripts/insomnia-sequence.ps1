param(
  [string]$Base = "http://localhost:3000",
  [string]$Symbol = ""  # optional: single symbol filter
)

function POST-Json {
  param([string]$Url, [hashtable]$Body)
  $json = ($Body | ConvertTo-Json -Depth 8)
  try {
    $r = Invoke-RestMethod -Method Post -Uri $Url -Body $json -ContentType "application/json" -TimeoutSec 20
    return $r
  } catch {
    Write-Warning "POST $Url failed: $($_.Exception.Message)"
  }
}

function GET-Json {
  param([string]$Url)
  try {
    return Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 20
  } catch {
    Write-Warning "GET $Url failed: $($_.Exception.Message)"
  }
}

# -------------------------------------------------------------------
Write-Host "=== STR-AUX Ingest Sequence ==="
Write-Host "Base URL: $Base"

# 1) Symbols + timing
$symbolsResp = GET-Json "$Base/api/str-aux/sources/symbols"
if (-not $symbolsResp.ok) { throw "symbols route failed" }

$symbols = $symbolsResp.symbols
if ($Symbol -ne "") { $symbols = $symbols | Where-Object { $_ -eq $Symbol.ToUpper() } }

$pointSec = [int]$symbolsResp.timing.point_sec
$cycleSec = [int]$symbolsResp.timing.cycle_sec
Write-Host "Symbols: $($symbols -join ', ')"
Write-Host "point=$pointSec s | cycle=$cycleSec s"

$nowMs = [int]([double](Get-Date -UFormat %s) * 1000)

# -------------------------------------------------------------------
foreach ($s in $symbols) {
  Write-Host "→ $s ingest sequence..."

  # 2) bins
  # numeric mid
$mid = [double](100 + (Get-Random -Minimum 0 -Maximum 30))

# depth arrays as numbers
$bids = @(
  @([double]($mid - 0.1), [double]0.5),
  @([double]($mid - 0.2), [double]1.2)
)
$asks = @(
  @([double]($mid + 0.1), [double]0.4),
  @([double]($mid + 0.2), [double]0.9)
)

  $binsRes = POST-Json "$Base/api/str-aux/sources/ingest/bins" @{
    symbol = $s; ts = $nowMs; bids = $bids; asks = $asks; meta = @{ src = "ps:bins" }
  }
  Write-Host "  [bins] ->" ($binsRes | ConvertTo-Json -Depth 4)

  # 3) 5s sampling
  $sampleRes = POST-Json "$Base/api/str-aux/sources/ingest/sampling/5s" @{
    symbol = $s; ts = $nowMs;
    density = 0.8;
    stats = @{ mid = $mid; spread = 0.2; w_bid = $bids[0][0]; w_ask = $asks[0][0] };
    model = @{ bids = $bids; asks = $asks }
  }
  Write-Host "  [5s] ->" ($sampleRes | ConvertTo-Json -Depth 4)

  # 4) roll cycle 40s
  $cycleRes = POST-Json "$Base/api/str-aux/sources/ingest/sampling/cycle" @{ symbol = $s; ts = $nowMs }
  Write-Host "  [cycle] ->" ($cycleRes | ConvertTo-Json -Depth 4)

  # 5) roll window 30m
  $winRes = POST-Json "$Base/api/str-aux/sources/ingest/sampling/window" @{ symbol = $s; label = "30m" }
  Write-Host "  [window] ->" ($winRes | ConvertTo-Json -Depth 4)
}

# 6) global tick (windows all)
$tickRes = POST-Json "$Base/api/str-aux/sources/ingest" @{}
Write-Host "[tick]" ($tickRes | ConvertTo-Json -Depth 4)

# 7) health
$healthRes = GET-Json "$Base/api/str-aux/sources/ingest"
Write-Host "[health]" ($healthRes | ConvertTo-Json -Depth 4)

# 8) (optional) verify stats / vectors / latest
$statsRes = GET-Json "$Base/api/str-aux/stats"
if ($statsRes) { Write-Host "[stats]" ($statsRes | ConvertTo-Json -Depth 4) }

$vectorsRes = GET-Json "$Base/api/str-aux/vectors"
if ($vectorsRes) { Write-Host "[vectors]" ($vectorsRes | ConvertTo-Json -Depth 4) }

$latestRes = GET-Json "$Base/api/str-aux/latest"
if ($latestRes) { Write-Host "[latest]" ($latestRes | ConvertTo-Json -Depth 4) }

Write-Host "=== done ==="
