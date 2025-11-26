SECURITY.md — Threat Model & Security Posture

Audience: devs, operators, and anyone assessing the security model.

Scope: high-level threat model, core principles, and how CryptoPill approaches auth, roles, DB security, secrets, and ops.

1. Security principles

Least privilege

Only grant the minimum permissions needed to users, services and roles.

Defence in depth

Combine frontend checks, API guards, DB roles, RLS policies, and network controls.

No secrets in code

API keys and passwords live in environment variables or secret managers, not in the repo.

Auditability

Keep logs for both application-level events and DB-level changes where reasonable.

Safe defaults

New features default to the most restrictive posture until explicitly opened.

SECURITY_IMPLEMENTATION.md will host the detailed, code-level and DDL-level specifics. This document stays at the conceptual/policy level.

2. Threat model (high level)

Assumptions:

The app may eventually handle:

API keys for exchanges (e.g. Binance).

User registration data.

Derived analytics about user positions or mood tiers.

Attackers may:

Probe the public web interface and APIs.

Try credential stuffing / brute force logins.

Attempt SQL injection or abuse of API parameters.

Compromise a host and attempt to exfiltrate secrets.

Goals:

Prevent unauthorized access to user accounts and API keys.

Prevent unauthorized access to DB data (both at the API and DB role level).

Minimize blast radius of a compromised component.

Out of scope for early versions:

Highly sophisticated nation-state actors.

Hardware-level exploits (e.g. side-channel attacks).

3. Authentication & sessions (conceptual)

Core ideas (implementation details live in SECURITY_IMPLEMENTATION.md):

Use a well-vetted authentication mechanism (NextAuth or equivalent) with:

Email+password or passwordless/email-link login in early stages.

Future room for MFA.

Passwords:

Stored as strong hashes (e.g. Argon2, scrypt, or bcrypt with high cost).

Never logged, never emailed.

Sessions:

Backed by secure cookies (HttpOnly, Secure, SameSite tuned appropriately).

Limited lifetime and inactivity timeouts.

For operator/admin flows:

Separate admin roles and routes.

Extra checks (e.g. IP allow-lists or step-up auth) can be added later.

4. Authorization, roles & RLS

Database security is centered around roles and Row-Level Security (RLS):

Roles (see ROLES_AND_RLS.md):

cp_admin — full control (DDL, DML) in non-prod; carefully limited in prod.

cp_writer — write access to business tables, no DDL.

cp_reader — read-only access.

Principles:

Application connections use a service role with only the needed grants.

RLS on sensitive tables ensures rows are filtered per-user or per-tenant where applicable.

Admin tools use a stronger role but are only reachable behind guarded routes.

Implementation details, including specific GRANT and ALTER POLICY statements, live in SECURITY_IMPLEMENTATION.md and the DDL files.

5. API surface: input validation & rate limiting

All API routes perform input validation (e.g. zod or equivalent) at the edge:

Types, ranges, enums, allowed symbols, etc.

Reject malformed or extreme requests early.

Apply rate limiting where relevant:

Per-IP or per-user limits on sensitive endpoints.

Backoff behavior when limits are exceeded.

Avoid leaking implementation details:

Error messages should be useful for debugging but not reveal sensitive info (no raw SQL errors to clients).

6. Secrets management

Types of secrets:

DB connection strings (DATABASE_URL).

Provider API keys (BINANCE_API_KEY, BINANCE_API_SECRET, etc.).

Session signing/encryption keys.

Rules:

Never commit secrets to Git (no .env in version control).

In dev, .env is acceptable but should stay local.

In prod/staging, use:

Cloud secret managers, or

Encrypted environment variables managed by your platform.

Rotate secrets periodically and after any suspected incident.

7. Network & infrastructure posture

Prefer hosted Postgres with private networking where possible.

Restrict DB access to application hosts and administrator IPs.

Use HTTPS everywhere for the web app; no plaintext HTTP exposed to the public Internet.

Optional hardening:

WAF in front of the app (for common web attacks).

SSH access via keys only, no password logins, on admin hosts.

8. Logging, monitoring & incident handling

Application logs:

Capture errors, warnings, and key events (job start/stop, auth events).

Ensure logs don’t contain secrets or full payloads of sensitive data.

DB logs:

Enable moderate logging of slow queries and errors.

Consider logging DDL and security-relevant events.

Monitoring:

Basic uptime checks for the web app and key APIs.

DB CPU/storage, connection counts, error rates.

Job freshness (via smokes and DB metrics).

Incident basics:

Detect (alerts or manual).

Contain (revoke keys, disable routes, stop jobs).

Eradicate (patch vulnerability, fix bug).

Recover (restore from backup if needed).

Learn (document in DEBUGGING_PLAYBOOK.md and, if user-impacting, in release notes).

9. Roadmap for security hardening

Future steps as the project matures:

Add MFA support for sign-in.

Add per-user API tokens (for advanced users) with scoped permissions.

Introduce audit tables for critical actions (role changes, key updates, etc.).

Formalize a secure deployment story (CI/CD with secrets management, signed builds).

External security review and/or penetration tests before broad public launch.