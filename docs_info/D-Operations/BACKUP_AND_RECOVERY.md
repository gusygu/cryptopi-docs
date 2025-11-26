BACKUP_AND_RECOVERY.md — Postgres Backups & Restores

Audience: operators and anyone responsible for data safety.

Scope: what needs to be backed up, when, how, and how to restore it safely.

1. What needs to be protected

The single source of truth for CryptoPill is the PostgreSQL database. If you lose it without backups, you lose:

settings: coin universe, windows, environment toggles.

market: symbol metadata and references.

str_aux: sampling, windows, vectors, IDHR-derived data.

matrices: pct24h, benchmarks, tiers, any derived matrices.

cin_aux: ledgers, sessions, moves, PnL history.

mea_dynamics: mood tiers, thresholds, associated signals.

ops: session logs, flags, operational metadata.

Any future modules.

Code (Git repo) is assumed to be backed up via your usual Git hosting. This document focuses on DB backups.

2. Backup strategy overview

We recommend a layered strategy:

Regular logical backups (via pg_dump):

Daily full backups of the entire database.

Compressed, stored off-host.

Periodic physical / snapshot backups:

Cloud provider DB snapshots (if using managed Postgres).

Filesystem-level snapshots if self-hosting.

Point-in-time recovery (PITR) (optional, advanced):

WAL archiving with a retention window (e.g. 7–30 days).

Pick at least (1) + (2). Add (3) if you need fine-grained recovery.

3. Logical backups with pg_dump
3.1. Full database dump

Example (Unix-like environment):

# Environment variables
export PGPASSWORD="your_password"


# Full dump
pg_dump \
  --host=localhost \
  --port=5432 \
  --username=cp_backup \
  --format=custom \
  --file=/backups/cryptopi_$(date +%F).dump \
  cryptopi_prod

Recommended options:

--format=custom to enable flexible restores via pg_restore.

A dedicated cp_backup role with CONNECT and SELECT on all schemas.

3.2. Scheduling

dev: optional, run ad-hoc as needed.

staging: once per day is usually enough.

prod: at least daily, preferably multiple times per day if database changes are intense.

Use cron, systemd timers, or your cloud scheduler to run pg_dump regularly.

4. Physical / snapshot backups

If you use a managed Postgres (e.g. RDS, Cloud SQL, Supabase, etc.):

Enable automated snapshots with a retention policy (e.g. 7–30 days).

Ensure snapshots are stored in a separate failure domain (e.g. different AZ/region if supported).

If you self-host Postgres:

Leverage filesystem snapshots (LVM/ZFS/btrfs) while Postgres is in a consistent state.

Or rely on pg_basebackup for physical backups.

Snapshots are ideal for fast, full-environment restore scenarios.

5. Off-site & encryption

For both logical and physical backups:

Store at least one copy off-site (different region/provider).

Encrypt at rest using:

Storage encryption (S3 SSE, GCS CMEK, etc.).

Or age/GPG envelope encryption before upload.

Keep encryption keys separate from the main environment (e.g. in a secure password manager or KMS).

6. Restore procedures
6.1. Restoring a logical backup (pg_restore)

Restore into a fresh database, not into the existing one, to avoid mixing data.

createdb cryptopi_restore


pg_restore \
  --host=localhost \
  --port=5432 \
  --username=cp_backup \
  --dbname=cryptopi_restore \
  --jobs=4 \
  /backups/cryptopi_2025-11-20.dump

Then:

Run smokes (SMOKES.md) against cryptopi_restore.

Verify data consistency (e.g. counts per symbol, latest timestamps).

Once confident, you can:

Swap application DATABASE_URL to point to cryptopi_restore, or

Dump from cryptopi_restore and restore into the original DB name during a maintenance window.

6.2. Restoring from snapshots

Use your provider’s UI/CLI to restore a snapshot as a new instance.

Point your app’s DATABASE_URL to the restored instance.

Run smokes before exposing it to users.

6.3. Point-in-time recovery

If PITR is configured:

Choose a target timestamp T before the incident.

Use your provider’s PITR mechanism to create a new instance at T.

Validate via smokes and then cut over.

7. Testing backups

A backup strategy is only real if restores are tested.

Recommended practice:

Quarterly: pick a recent backup and restore it to a staging-like environment.

Run the minimal smoke suite (SMOKES.md).

Spot-check key flows (UI, jobs, matrices).

Document successful tests and any issues found.

8. Disaster scenarios & runbooks

Typical scenarios:

Accidental data deletion (e.g. truncate without where):

Freeze writes.

Restore from the most recent backup (or PITR) to a new DB.

Decide whether to merge or cut over fully.

DB instance loss (hardware or cloud incident):

Restore from snapshot to a fresh instance.

Point app DATABASE_URL to the new instance.

Corrupted data / malformed migration:

Roll back using a backup taken before the migration.

Fix migration, rehearse on staging, and reapply.

For each incident, keep short runbooks in DEBUGGING_PLAYBOOK.md or a separate ops wiki.