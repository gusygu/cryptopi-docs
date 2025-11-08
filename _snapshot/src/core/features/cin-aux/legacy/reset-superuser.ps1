<#  reset_postgres_superuser.ps1
    Resets the postgres superuser password for one or more Windows PostgreSQL services.
    - Detects DataDir and Port from the service
    - Temporarily sets local auth (127.0.0.1 / ::1) to 'trust'
    - Applies: ALTER ROLE postgres WITH PASSWORD '...'
    - Restores original pg_hba.conf
#>

# ================== CONFIG: EDIT THIS SECTION ==================
# Option A: same password for ALL services (uncomment next line)
$onePasswordForAll = $true
$allNewPassword    = 'gus!'   # used only if $onePasswordForAll = $true

# List target services (exact Windows service names)
$targets = @(
  'postgresql-x64-14',
  'postgresql-x64-17'
)

# Option B: per-service override (only used if $onePasswordForAll = $false)
$perServicePasswords = @{
  'postgresql-x64-14' = 'NewStrongPass_v14!'
  'postgresql-x64-17' = 'NewStrongPass_v17!'
}
# ===============================================================

$ErrorActionPreference = 'Stop'

function Get-PgServiceInfo {
  param([string]$ServiceName)

  $svc = Get-WmiObject Win32_Service -Filter "Name='$ServiceName'"
  if (-not $svc) { throw "Service '$ServiceName' not found." }

  # Example PathName:
  # "C:\Program Files\PostgreSQL\14\bin\pg_ctl.exe" runservice -N "postgresql-x64-14" -D "C:\Program Files\PostgreSQL\14\data"
  $path = $svc.PathName

  if ($path -match '\\PostgreSQL\\(\d+)\b') { $version = $Matches[1] }
  else { throw "Cannot parse PostgreSQL version from PathName: $($svc.PathName)" }

  if ($path -match '-D\s+"([^"]+)"') { $dataDir = $Matches[1] }
  else { throw "Cannot find -D data directory in PathName: $($svc.PathName)" }

  $conf = Join-Path $dataDir 'postgresql.conf'
  if (-not (Test-Path $conf)) { throw "postgresql.conf not found at $conf" }

  # Read configured port (default to 5432 if not present)
  $port = 5432
  $portLine = Select-String -Path $conf -Pattern '^[\s#]*port\s*=\s*(\d+)' | Select-Object -First 1
  if ($portLine) { $port = [int]$portLine.Matches[0].Groups[1].Value }

  $binDir = "C:\Program Files\PostgreSQL\$version\bin"
  $psql   = Join-Path $binDir 'psql.exe'
  $isready= Join-Path $binDir 'pg_isready.exe'

  return [pscustomobject]@{
    ServiceName = $ServiceName
    Version     = $version
    DataDir     = $dataDir
    ConfPath    = $conf
    Port        = $port
    BinDir      = $binDir
    PsqlPath    = $psql
    IsReadyPath = $isready
  }
}

function Backup-File($path) {
  $bak = "$path.bak"
  Copy-Item $path $bak -Force
  return $bak
}

function Set-LocalTrust($hbaPath) {
  # replace auth method for localhost IPv4/IPv6 lines to 'trust'
  $content = Get-Content $hbaPath -Raw
  $content = $content -replace '(^\s*host\s+all\s+all\s+127\.0\.0\.1/32\s+)\w+','${1}trust'
  $content = $content -replace '(^\s*host\s+all\s+all\s+::1/128\s+)\w+','${1}trust'
  Set-Content -Path $hbaPath -Value $content -Encoding UTF8
}

function Restore-FromBak($path, $bakPath) {
  if (Test-Path $bakPath) { Move-Item $bakPath $path -Force }
  else { Write-Warning "Backup not found for $path; leaving current file in place." }
}

function Apply-Password {
  param([object]$info, [string]$newPass)

  if (-not (Test-Path $info.PsqlPath)) { throw "psql not found at $($info.PsqlPath)" }

  # try to wait until instance is accepting connections
  if (Test-Path $info.IsReadyPath) {
    for ($i=0; $i -lt 10; $i++) {
      $out = & $info.IsReadyPath -h 127.0.0.1 -p $info.Port 2>$null
      if ($LASTEXITCODE -eq 0 -or "$out" -match 'accepting connections') { break }
      Start-Sleep -Seconds 1
    }
  } else {
    Start-Sleep -Seconds 2
  }

  & $info.PsqlPath -h 127.0.0.1 -p $info.Port -U postgres -d postgres -v ON_ERROR_STOP=1 `
    -c "ALTER ROLE postgres WITH PASSWORD '$newPass';"
}

foreach ($svc in $targets) {
  Write-Host "`n==== [$svc] reset postgres superuser password ====" -ForegroundColor Cyan
  $info = Get-PgServiceInfo -ServiceName $svc
  $hba  = Join-Path $info.DataDir 'pg_hba.conf'
  if (-not (Test-Path $hba)) { throw "pg_hba.conf not found at $hba" }

  $newPassword = if ($onePasswordForAll) { $allNewPassword } else { $perServicePasswords[$svc] }
  if ([string]::IsNullOrWhiteSpace($newPassword)) {
    throw "No password configured for service '$svc'."
  }

  Write-Host ("Service     : {0}`nVersion     : {1}`nDataDir     : {2}`nPort        : {3}" -f `
    $info.ServiceName, $info.Version, $info.DataDir, $info.Port)

  # 1) backup pg_hba.conf
  $bak = Backup-File $hba
  Write-Host "Backed up pg_hba.conf -> $bak"

  try {
    # 2) flip to trust for localhost
    Set-LocalTrust $hba
    Write-Host "Set local auth to TRUST for 127.0.0.1 / ::1"

    # 3) restart service
    Restart-Service $info.ServiceName -Force
    Write-Host "Service restarted."

    # 4) apply ALTER ROLE
    Write-Host "Applying new password via psql on port $($info.Port)..."
    Apply-Password -info $info -newPass $newPassword
    Write-Host "ALTER ROLE succeeded." -ForegroundColor Green
  }
  catch {
    Write-Warning "Failed while updating $svc: $($_.Exception.Message)"
    throw
  }
  finally {
    # 5) restore pg_hba.conf and restart
    Restore-FromBak $hba $bak
    Write-Host "Restored original pg_hba.conf"
    Restart-Service $info.ServiceName -Force
    Write-Host "Final restart complete."
  }

  Write-Host "✅ [$svc] password reset complete." -ForegroundColor Green
}
Write-Host "`nAll done. Connect with user 'postgres' and your new password(s)." -ForegroundColor Cyan
