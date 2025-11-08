$ErrorActionPreference = "Stop"
$envFile = ".env.db"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^\s*#") { return }
    if ($_ -match "^\s*$") { return }
    $k,$v = $_.Split("=",2)
    [System.Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim())
  }
}

function Apply([string]$file) {
  if (Test-Path $file) {
    & psql -X -v ON_ERROR_STOP=1 -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -f $file
  }
}

# Ensure DB exists
& psql -X -v ON_ERROR_STOP=1 -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d postgres -c @"
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$env:PGDATABASE') THEN
    EXECUTE 'CREATE DATABASE $env:PGDATABASE';
  END IF;
END
\$\$;
"@

# Base DDLs
Apply "00_schemas.sql"
Apply "01_extensions.sql"
Apply "02_settings.sql"
Apply "03_market.sql"
Apply "04_documents.sql"
Apply "05_matrices.sql"
Apply "06_str-aux.sql"
Apply "07_cin-aux-core.sql"
Apply "08_cin-aux-runtime.sql"
Apply "09_cin-aux-functions.sql"
Apply "10_mea_dynamics.sql"
Apply "11_ops.sql"
Apply "12_views-latest.sql"
Apply "13_roles.sql"
Apply "14_security-grants.sql"
Apply "15_security-rls.sql"
Apply "16_rls.sql"
Apply "17_security.sql"

Write-Host "✅ DDL applied."

if (process.env.RUN_SQL_SEEDS === "1") {
  console.log("🌱 SQL seed mode enabled");
  const dir = process.env.SEED_DIR ?? "src/core/db/seeds";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql"));
  console.log(`🌱 Found ${files.length} SQL file(s) in ${dir}`);

  for (const f of files) {
    const full = path.join(dir, f);
    const sql = fs.readFileSync(full, "utf8");
    console.log(`→ Running ${f}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      console.log(`✓ ${f} done`);
    } catch (err: any) {
      await client.query("ROLLBACK");
      console.error(`✖ Failed on ${f}:`, err.message);
      throw err;
    }
  }
}

