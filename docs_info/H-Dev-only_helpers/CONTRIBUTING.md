CONTRIBUTING.md
Guidelines for Contributors
1. Branching Model

main: stable branch

dev: integration

feature/*: feature-specific branches

2. Commit Messages

Use short prefixes:

feat: new user-facing capability

fix: repairs

docs: documentation updates

db: DDL or schema work

core: internal logic

ops: session / ingestion changes

3. Code Style

TypeScript strict mode

Clean async flow (no nested promise pyramids)

Keep modules self-contained

4. Pull Requests

Small, atomic

Include notes of impacted modules

Ensure ddl → seed → smoke pass