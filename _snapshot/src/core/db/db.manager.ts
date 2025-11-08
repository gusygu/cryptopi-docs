// src/core/db/db.manager.ts
import type { Pool } from "pg";
import { getPool } from "./db";

/** Minimal per-session KV with TTL (ephemeral process store) */
class SessionKV<V = unknown> {
  private s = new Map<string, { v: V; exp?: number }>();
  set(ns: string, key: string, v: V, ttlMs?: number) {
    const k = `${ns}:${key}`; this.s.set(k, { v, exp: ttlMs ? Date.now()+ttlMs : undefined });
  }
  get(ns: string, key: string): V | undefined {
    const k = `${ns}:${key}`; const e = this.s.get(k); if (!e) return;
    if (e.exp && Date.now()>e.exp) { this.s.delete(k); return; } return e.v;
  }
  delete(ns: string, key: string) { this.s.delete(`${ns}:${key}`); }
  clear(ns?: string) {
    if (!ns) return this.s.clear();
    const p = `${ns}:`; for (const k of Array.from(this.s.keys())) if (k.startsWith(p)) this.s.delete(k);
  }
}

export class DbManager {
  private pool: Pool;
  readonly sessions = new SessionKV<any>();

  constructor(pool?: Pool) {
    this.pool = pool ?? getPool();
  }
  getPool() { return this.pool; }
}
