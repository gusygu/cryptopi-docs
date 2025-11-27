import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runBatch } from "./client";

/**
 * We sanitize ONLY top-level SQL (outside $$ ... $$ function bodies).
 * - Comment out accidental placeholders (..., …) and stray plpgsql control tokens (if/for/loop/etc)
 * - Then fix dangling ",)" that can result from commenting out a column/constraint line
 */
function sanitizeTopLevel(sql: string): string {
  const lines = sql.split(/\r?\n/);

  // crude but effective $$ toggler
  let inDollar = false;
  const dollarLine = /^\s*\$\$\s*$/;

  const ctrlTopLevel = /^\s*(if\b|elsif\b|end\s+if\b|for\b|loop\b|then\b)/i;

  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (dollarLine.test(line)) {
      inDollar = !inDollar;
      out.push(line);
      continue;
    }

    if (!inDollar) {
      if (line.includes("...") || line.includes("…") || ctrlTopLevel.test(line)) {
        out.push(`-- [sanitized@apply] ${line}`);
      } else {
        out.push(line);
      }
    } else {
      out.push(line);
    }
  }

  // Second pass: fix trailing ",)" sequences that may appear in OUT-OF-DOLLAR segments
  // We split by $$ blocks, patch only the even (non-dollar) chunks, and re-stitch.
  const stitched: string[] = [];
  let toggled = false;

  for (const chunk of out.join("\n").split(/\n(\$\$)\n/)) {
    if (chunk === "$$") {
      stitched.push("$$");
      toggled = !toggled;
      continue;
    }
    if (!toggled) {
      // outside $$: collapse ",   )" → ")"
      stitched.push(chunk.replace(/,\s*\)/g, ")"));
    } else {
      // inside $$: leave untouched
      stitched.push(chunk);
    }
  }

  return stitched.join("\n");
}

export async function applySqlFile(relPath: string, label?: string) {
  const abs = resolve(process.cwd(), relPath);
  let sql = await readFile(abs, "utf8");
  sql = sanitizeTopLevel(sql);
  const tag = label ?? relPath;
  console.log(`[sql] applying ${tag}…`);
  await runBatch(sql);
  console.log(`[sql] ✔ applied ${tag}`);
}
