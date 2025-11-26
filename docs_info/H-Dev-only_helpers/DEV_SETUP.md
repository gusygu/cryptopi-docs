DEV_SETUP.md
Overview

This guide explains how to set up the development environment, clone the repository, install dependencies, configure environment variables, and bootstrap the database.

1. Clone the Repository
git clone <repo-url>
cd cryptopi-dynamics
2. Install Dependencies
pnpm install

Includes all app modules, scripts, and helpers.

3. Environment Variables

Create a .env.local file in project root.

Required variables:

DATABASE_URL

Exchange keys when needed (optional in dev)

Any additional test keys

4. Database Setup
Apply DDLs
pnpm db:ddl

This runs all SQL files under src/core/db/ddl in correct order.

Seed

Optional initial data:

pnpm db:seed
5. Run Dev Server
pnpm dev

Application available on default Next.js port.

6. Run Daemons / Jobs
pnpm jobs:daemon

Executes ingestion, windowing, and matrix refresh flows.