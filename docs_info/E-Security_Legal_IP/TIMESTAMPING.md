TIMESTAMPING.md
1. Purpose

To prove when a code/doc state existed and when a deployed build opened sessions.

2. DB Session Stamping

Defined in ops schema.

2.1 Structures

ops.session_log — history.

ops.session_flags — current open state.

2.2 Functions

ops.open_all_sessions(app_name, app_version) — stamps all schemas with open state.

2.3 Per-Schema Views
create or replace view matrices.v_session_open as
select is_open, opened_at, updated_at
from ops.session_flags
where schema_name='matrices';
2.4 Usage

Run on deploy:

APP_NAME=cryptopi APP_VERSION=0.1.1 node scripts/ops-open-all-session.mts
3. Documentation Timestamping

Regenerate HASHES.sha256.txt.

Commit + tag.

Anyone can verify with sha256sum --check.

4. External Anchors

Public Git.

Timestamping services.

Blockchain anchor (optional).

5. Ops Use Cases

Correlate data issues with deployment time.

Cross-check job failures vs. stamped sessions.