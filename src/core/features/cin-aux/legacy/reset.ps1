# --- CONFIG: set the new postgres password ---
$NEWPASS = 'gus'     # <- put your new password here

# Target service (from your list)
$SERVICE = 'postgresql-x64-17'

# ---- discover paths/port from the service ----
$svc = Get-WmiObject Win32_Service -Filter "Name='$SERVICE'"
if (-not $svc) { throw "Service $SERVICE not found." }

if ($svc.PathName -notmatch '\\PostgreSQL\\(\d+)\b') { throw "Cannot parse version from PathName: $($svc.PathName)" }
$VER = $Matches[1]

if ($svc.PathName -notmatch '-D\s+"([^"]+)"') { throw "Cannot locate data dir (-D ...) in PathName." }
$DATA = $Matches[1]
$HBA  = Join-Path $DATA 'pg_hba.conf'
$CONF = Join-Path $DATA 'postgresql.conf'
$BIN  = "C:\Program Files\PostgreSQL\$VER\bin"
$PSQL = Join-Path $BIN 'psql.exe'
$READY= Join-Path $BIN 'pg_isready.exe'

if (-not (Test-Path $HBA)) { throw "pg_hba.conf not found: $HBA" }
if (-not (Test-Path $PSQL)) { throw "psql not found: $PSQL" }

# Read port (default 5432 if not specified)
$port = 5432
$pl = Select-String -Path $CONF -Pattern '^[\s#]*port\s*=\s*(\d+)' | Select-Object -First 1
if ($pl) { $port = [int]$pl.Matches[0].Groups[1].Value }
Write-Host "Service=$SERVICE  Version=$VER  Data=$DATA  Port=$port"

# --- backup hba, switch localhost to TRUST ---
Copy-Item $HBA "$HBA.bak" -Force
$raw = Get-Content $HBA -Raw
$raw = $raw -replace '(^\s*host\s+all\s+all\s+127\.0\.0\.1/32\s+)\w+','${1}trust'
$raw = $raw -replace '(^\s*host\s+all\s+all\s+::1/128\s+)\w+','${1}trust'
Set-Content -Path $HBA -Value $raw -Encoding UTF8

Restart-Service $SERVICE -Force
if (Test-Path $READY) { & $READY -h 127.0.0.1 -p $port | Out-Null; Start-Sleep 2 } else { Start-Sleep 2 }

# --- reset the password (no old password required now) ---
& $PSQL -h 127.0.0.1 -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 `
  -c "ALTER ROLE postgres WITH PASSWORD '$NEWPASS';"

# --- restore original hba and restart ---
Move-Item "$HBA.bak" $HBA -Force
Restart-Service $SERVICE -Force

Write-Host "✅ postgres password reset on $SERVICE (port $port)."
