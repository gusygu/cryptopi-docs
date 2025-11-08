param(
  [string]$File = "cin-aux-pack.sql",
  [string]$DatabaseUrl = "postgres://postgres:gus@localhost:1026/cryptopi_dynamics",
  [string]$DbHost = "localhost",   # <- renamed (no conflict)
  [int]$Port = 1026,
  [string]$User = "postgres",
  [string]$Password = "gus",
  [string]$Database = "cryptopi_dynamics",
  [string]$SslMode = ""
)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js not found in PATH"
  exit 127
}

if (-not (Test-Path $File -PathType Leaf)) {
  Write-Error "SQL file not found: $File"
  exit 2
}

# Prefer DATABASE_URL if provided
if ($DatabaseUrl) {
  $env:DATABASE_URL = $DatabaseUrl
} else {
  if (-not $User -or -not $Database) {
    Write-Error "Provide -DatabaseUrl or -User and -Database (optionally -Password, -DbHost, -Port)"
    exit 3
  }
  $env:PGHOST = $DbHost
  $env:PGPORT = "$Port"
  $env:PGUSER = $User
  $env:PGPASSWORD = $Password
  $env:PGDATABASE = $Database
  if ($SslMode) { $env:PGSSLMODE = $SslMode }
}

# Require 'pg' to be installed already (avoids npm flakiness)
try {
  node -e "require('pg')" | Out-Null
} catch {
  Write-Error "Dependency missing: install with 'npm i pg' or 'pnpm add pg' (in this folder)"
  exit 4
}

node .\apply_cin_aux.mjs -f $File
