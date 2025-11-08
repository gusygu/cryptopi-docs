import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { withTransaction } from "@/core/features/cin-aux/db";

export async function POST() {
  try {
    const sql = await readFile(process.cwd() + "/src/core/db/cin-aux-pack.sql", "utf8");
    await withTransaction(async (c) => {
      await c.query(`SET lock_timeout = '15s'; SET statement_timeout = '10min';`);
      await c.query(sql);
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
