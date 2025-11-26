PRIVACY_POLICY_DRAFT.md
1. Purpose

A draft, user-facing privacy policy describing how CryptoPill handles data.

2. What We Collect

Email + minimal registration data.

Session identifiers.

Operational logs.

Market data (public; not user-specific).

User-submitted preferences.

We do not collect:

Location without consent.

Sensitive personal data (health, political, etc.).

3. Why We Collect It

Provide access to the app.

Maintain security, integrity and session validity.

Diagnose performance or errors.

Improve user experience.

4. How Data Is Stored

Stored in PostgreSQL with RLS and strict roles.

Access restricted to app and designated admins.

Backed up and encrypted as per BACKUP_AND_RECOVERY.md.

5. Sharing of Data

We don’t sell or share personal data. We may share:

Infrastructure-level metadata with hosting providers.

Encrypted backups with disaster recovery services.

Aggregated, anonymized stats.

6. Rights of Users

Users may:

Request account deletion.

Request export of their data.

Request correction of inaccurate information.

7. Security Measures

RLS, strict roles, encryption-in-transit.

Regular smokes for integrity.

Incident response and secret rotation.

8. Cookies & Sessions

Used for login and security.

HttpOnly, Secure and SameSite flags.

No tracking cookies.

9. Contact

A placeholder contact for complaints or questions (to be filled upon deployment).