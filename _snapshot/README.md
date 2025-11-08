# CryptoPi Dynamics

**CryptoPi Dynamics** is an autonomous framework for quantitative analysis and orchestration of cryptocurrency market data.  
It unifies ingestion, structural processing, and statistical synthesis across multiple dynamic modules.

---

## 🧠 Overview

CryptoPi Dynamics implements a modular stack:

| Layer | Schema / Module | Purpose |
|-------|------------------|----------|
| **Market** | `market` | Synchronizes coin universe and raw market data (symbols, klines, orderbooks). |
| **Matrices** | `matrices` | Provides benchmark and delta correlation matrices for assets and time windows. |
| **STR-AUX** | `str_aux` | Generates structural vectors and statistical summaries from sampled market dynamics. |
| **CIN-AUX** | `cin_aux` | Computes ledgered profit and flow derivations (optional subsystem). |
| **MEA-Dynamics** | `mea_dynamics` | Experimental layer for mood/entropy analytics. |

All schemas are built on **PostgreSQL 14+** with TypeScript orchestrators (Node 22 + TSX).

---

## ⚙️ Stack

- **Language:** TypeScript / SQL / PLpgSQL  
- **Runtime:** Node.js 22 +, PNPM 8 +  
- **Database:** PostgreSQL 15 +  
- **Frontend (optional):** Next.js / React + Tailwind  
- **APIs:** REST + JSON routes under `/api/market`, `/api/matrices`, `/api/str-aux`, `/api/cin-aux`  

---

## 🧩 Core Components

### `/src/core/db/ddl`
Contains the declarative database structure for all schemas.  
Each file defines a logical layer (e.g. `03_market.sql`, `06_str-aux.sql`).

### `/src/core/sources`
Adapters for external data sources such as Binance.  
Implements unified fetchers for klines, tickers, and orderbooks.

### `/src/scripts`
Maintenance and smoke scripts used for diagnostics, seeding, and orchestration.

---

## 🚀 Functional Flow

1. **Discovery** — fetch symbols from exchange and register them in `market.symbols`.
2. **Ingestion** — pull klines/orderbooks per window and store in `market.klines`.
3. **Structural Roll-up** — compute vectors and stats in `str_aux` schema.
4. **Matrix Computation** — aggregate deltas and correlations in `matrices`.
5. **Visualization / API Layer** — expose analytical endpoints for dashboard or client UI.

---

## 📦 Installation (Developer Mode)

```bash
pnpm install
pnpm run run-ddl       # applies SQL schemas
pnpm run smoke:pipeline
