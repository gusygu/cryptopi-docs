# ================== CONFIGURE THESE ==================
$targets = @(
  @{ Service = 'postgresql-x64-14'; NewPassword = 'gus!' },
  @{ Service = 'postgresql-x64-17'; NewPassword = 'gus!' }
)
# =====================================================

function Get-PgServiceInfo {
  param([string]$Service)

  $svc = Get-WmiObject Win32_Service -Filter "Name='$Service'"
  if (-not $svc) { throw "Service $Service not found." }

  # Example PathName:
  # "C:\Program Files\PostgreSQL\14\bin\pg_ctl.exe" runservice -N "postgresql-x64-14" -D "C:\Program Files\PostgreSQL\14\data"
  $path = $svc.PathName

  # Extract version from path (14/17)
  if ($path -match '\\PostgreSQL\\(\d+)\b') { $ver = $Matches[1] } else { throw "Cannot parse version from $($svc.PathName)" }

  # Extract data dir after -D "..."
  if ($path -match '-D\s+"([^"]+)"') { $dataDir = $Matches[1] } else { throw "Cannot find -D data directory in $($svc.PathName)" }

  $conf = Join-Path $dataDir 'postgresql.conf'
  if (-not (Test-Path $conf)) { throw "postgresql.conf not found at $conf" }

  # Read configured port (fallback to 5432 if not set)
  $portLine = Select-String -Path $conf -Pattern '^[\s#]*port\s*=\s*(\d+)' | Select-Object -First 1
  $port = if ($portLine -and $portLine.Matches[0].Groups[1].Value) { [int]$portLine.Matches[0].Groups[1].Value } else { 5432 }

  return [pscustomobject]@{
    ServiceName = $Service
    Version     = $ver
    DataDir     = $dataDir
    ConfPath    = $conf
    Port        = $port
    BinDir      = "C:\Program Files\PostgreSQL\$ver\bin"
  }
}

function Set-LocalTrust {
  param([string]$DataDir)

  $hba = Join-Path $DataDir 'pg_hba.conf'
  if (-not (Test-Path $hba)) { throw "pg_hba.conf not found at $hba" }

  Copy-Item $hba "$hba.bak" -Force

  $content = Get-Content $hba -Raw
  # Replace auth method for local IPv4/IPv6 lines to trust
  $content = $content -replace '(^\s*host\s+all\s+all\s+127\.0\.0\.1/32\s+)\w+','${1}trust'
  $content = $content -replace '(^\s*host\s+all\s+all\s+::1/128\s+)\w+','${1}trust'
  Set-Content -Path $hba -Value $content -Encoding UTF8
}

function Restore-HbaAuth {
  param([string]$DataDir)

  $hba = Join-Path $DataDir 'pg_hba.conf'
  $bak = "$hba.bak"
  if (Test-Path $bak) {
    Move-Item $bak $hba -Force
  } else {
    # As a fallback, switch trust back to scram on the same two lines
    $content = Get-Content $hba -Raw
    $content = $content -replace '(^\s*host\s+all\s+all\s+127\.0\.0\.1/32\s+)trust','${1}scram-sha-256'
    $content = $content -replace '(^\s*host\s+all\s+all\s+::1/128\s+)trust','${1}scram-sha-256'
    Set-Content -Path $hba -Value $content -Encoding UTF8
  }
}

function Reset-PostgresPassword {
  param(
    [string]$Service,
    [string]$NewPassword
  )

  $info = Get-PgServiceInfo -Service $Service

  Write-Host ">>> [$Service] DataDir=$($info.DataDir) Port=$($info.Port) Version=$($info.Version)"

  Write-Host ">>> [$Service] Setting pg_hba.conf to trust for local connections..."
  Set-LocalTrust -DataDir $info.DataDir

  Write-Host ">>> [$Service] Restarting service..."
  Restart-Service $info.ServiceName -Force

  $psql = Join-Path $info.BinDir 'psql.exe'
  if (-not (Test-Path $psql)) { throw "psql not found at $psql" }

  # Wait until ready
  $pgIsReady = Join-Path $info.BinDir 'pg_isready.exe'
  if (Test-Path $pgIsReady) {
    & $pgIsReady -h 127.0.0.1 -p $info.Port | Out-Null
    Start-Sleep -Seconds 2
  } else {
    Start-Sleep -Seconds 3
  }

  Write-Host ">>> [$Service] Applying new password..."
  & $psql -h 127.0.0.1 -p $info.Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE postgres WITH PASSWORD '$NewPassword';" |
    Write-Host

  Write-Host ">>> [$Service] Restoring pg_hba.conf..."
  Restore-HbaAuth -DataDir $info.DataDir

  Write-Host ">>> [$Service] Final restart..."
  Restart-Service $info.ServiceName -Force

  Write-Host "✅  [$Service] Password reset complete."
}

foreach ($t in $targets) {
  Reset-PostgresPassword -Service $t.Service -NewPassword $t.NewPassword
}

Write-Host "`nAll done. Try connecting from pgAdmin with the new passwords."
