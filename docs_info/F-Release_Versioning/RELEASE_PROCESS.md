RELEASE_PROCESS.md
1. Purpose

Establishes the official workflow for cutting a CryptoPill release — from freeze → DDL sync → docs pack → hashing → tagging → deployment → session stamping.

2. Preconditions

Before beginning a release flow:

All code intended for this version is merged.

DDL pack is consistent, ordered, and validated on dev.

Smokes pass on dev environment:

Schema diagnostics

Str-aux sampling

IDHR

Persistence auto-smoke

VERSION file updated (e.g. 0.1.1).

SOURCE_TAG updated (matching the version if using docs submodule).

3. Freeze Window

Declare a short freeze (no new features).

Fix critical bugs only.

Generate a release branch (optional):

git checkout -b release/v0.1.1

Ensure DDL order is locked:

No renaming of files.

No structural shifts unless absolutely required.

4. Build the Docs Pack

Following DOCS_PACKING.md:

Regenerate VERSION.

Regenerate SOURCE_TAG.

Generate new docs/HASHES.sha256.txt:

Include key docs.

Include core DDL files.

Include CHANGELOG or release notes.

Commit the updated docs.

Example structure:

docs/
  ARCHITECTURE.md
  DATABASE.md
  ...
  HASHES.sha256.txt
VERSION
SOURCE_TAG

Commit:

git add VERSION SOURCE_TAG docs/HASHES.sha256.txt
git commit -m "docs: update version + hashes for v0.1.1"
5. Tag the Release
git tag v0.1.1
git push origin v0.1.1

Optional signed tag:

git tag -s v0.1.1 -m "CryptoPill v0.1.1"
6. Prepare Release Notes

Using RELEASE_NOTES_TEMPLATE.md:

Fill highlights.

Summaries of major changes.

DDL changes.

Evidence-pack section.

Deployment requirements.

Commit notes under:

docs/releases/v0.1.1.md
7. Deploy to Staging
7.1 Steps

Deploy code.

Apply DDLs:

pnpm tsx src/scripts/db/run-ddls.mts

Run smokes.

Run ops stamping:

APP_NAME=cryptopi-dynamics APP_VERSION=0.1.1 \
node scripts/ops-open-all-session.mts
7.2 Acceptance

Release proceeds only if:

API OK

UI renders all views

Sampling/matrices are fresh

No gaps in ingest

No SQL warnings in server logs

8. Deploy to Production

Backup prod DB (see BACKUP_AND_RECOVERY.md).

Apply DDL pack following the ordered list.

Deploy app.

Run ops stamping with production version.

Verify smokes.

Flip traffic if in blue/green setup.

9. Archive and Register Evidence Pack

See IP_AND_REGISTRATION.md.

Store tagged bundle.

Keep hashes in offline + encrypted storage.

Prepare INPI filing if needed.

10. Post-Release

Merge release branch back to main.

Bump VERSION to next dev number (e.g. 0.1.2-dev).

Open the cycle.