VERSIONING.md
1. Purpose

Defines how versions are assigned, what version numbers mean, and how CryptoPill manages releases across code, database DDL, docs, and IP evidence packs.

2. Version Scheme

CryptoPill uses semantic-style versioning with operational extensions:

MAJOR.MINOR.PATCH[-tag]
2.1 Components

MAJOR — Breaking changes to DB schemas, architecture, or core conceptual models.

MINOR — Feature additions that do not break compatibility (new modules, new views, new screens).

PATCH — Bug fixes, small corrections, non-breaking improvements.

tag (optional) — alpha, beta, rc1, dev, exp, etc.

Examples:

0.1.1-dev — Development build.

0.1.1 — Stable patch release.

0.2.0-rc1 — Release candidate for next minor.

3. Version Alignment Across System

The version number must stay consistent across:

3.1 Code

Stored in VERSION file at repo root or docs submodule.

UI footer may optionally display version.

3.2 DDL

ops.open_all_sessions(app_name, app_version) stores app_version in ops.session_flags.

Migrations must update version references where applicable.

3.3 Docs

Documentation packs include versioned hashes in docs/HASHES.sha256.txt.

Whitepapers and UX docs may reference the version.

3.4 IP / Evidence Packs

See IP_AND_REGISTRATION.md — version must match the Git tag and hash file.

4. When to Bump Versions
4.1 MAJOR bump when:

Core schemas change incompatibly.

RLS model changes incompatibly.

Core economics/mood logic changes conceptually.

4.2 MINOR bump when:

New modules added.

Data-flow layers expanded.

New UI features added.

DDL changes that are additive.

4.3 PATCH bump when:

Hotfixes.

UI adjustments.

Non-breaking DDL tweaks.

Improved sampling, fixes in runners.

5. Pre-release Tags

-dev — local development.

-alpha — early internal testing.

-beta — feature-complete, not validated.

-rcX — release candidate.

6. Version Governance

Every merge into the main branch must either:

Keep the current version (if non-release), or

Bump the version file explicitly.

Releases must be cut only after the docs and DDL are consistent.

7. Verification

To verify that a working tree matches a released version:

Check VERSION matches expected.

Check Git tag vX.Y.Z exists.

Run:

sha256sum --check docs/HASHES.sha256.txt

If all pass, the release is consistent.