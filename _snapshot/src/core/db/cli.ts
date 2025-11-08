// src/core/db/cli.ts
import { runUnifiedDDL } from "./migrate";
import { appendAppLedger, getAppLedgerSince } from "@/core/db/ledger";
import {
  createReference, nearestReference, prevReference, nextReference,
  listReferences, markReferenceUploaded, listPendingReferences
} from "./db.ref"; // ⬅️ was "./db.ref"
import { ensureOpening, getOpeningFromDb, clearOpeningCache } from "./db";
import {
  createAppSession, useAppSession, currentAppSession, listAppSessions,
  parseDuration, parseNowOrMs, startOfWindow, endOfWindow, align,
  ensureCyclesBetween, floorToPeriod
} from "@/core/db/session";

function die(msg: string, code = 1): never { // ⬅️ return never so TS narrows
  console.error(msg);
  process.exit(code);
}

const [, , cmd, sub, ...rest] = process.argv;

function flag(name: string, def?: string) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def; // string | undefined
}
function has(name: string) { return rest.includes(`--${name}`); }

/** require a flag, or exit; narrows to string */
function req(name: string): string {
  const v = flag(name);
  if (!v) die(`missing --${name}`);
  return v;
}

async function main() {
  switch (cmd) {
    case "migrate": {
      await runUnifiedDDL();
      console.log("DDL applied ✅");
      break;
    }

    case "reference": {
      switch (sub) {
        case "create": {
          const ref = req("ref");
          const tsStr = flag("ts", "now")!;
          const sess = flag("session");
          const t = tsStr === "now" ? Date.now() : Number(tsStr);
          if (!Number.isFinite(t)) die("invalid --ts");
          const out = await createReference(ref, t, sess ?? undefined);
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        case "nearest": {
          const tsStr = flag("ts", "now")!;
          const ref = flag("ref");
          const sess = flag("session");
          const t = tsStr === "now" ? Date.now() : Number(tsStr);
          if (!Number.isFinite(t)) die("invalid --ts");
          const out = await nearestReference(t, { ref: ref ?? undefined, appSessionId: sess ?? undefined });
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        case "prev": {
          const tsStr = req("ts");
          const ref = flag("ref");
          const sess = flag("session");
          const t = Number(tsStr);
          if (!Number.isFinite(t)) die("invalid --ts");
          const out = await prevReference(t, { ref: ref ?? undefined, appSessionId: sess ?? undefined });
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        case "next": {
          const tsStr = req("ts");
          const ref = flag("ref");
          const sess = flag("session");
          const t = Number(tsStr);
          if (!Number.isFinite(t)) die("invalid --ts");
          const out = await nextReference(t, { ref: ref ?? undefined, appSessionId: sess ?? undefined });
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        case "list": {
          const ref = flag("ref");
          const sess = flag("session");
          const before = flag("before");
          const after = flag("after");
          const limit = Number(flag("limit", "50"));
          const out = await listReferences({
            ref: ref ?? undefined,
            appSessionId: sess ?? undefined,
            beforeTs: before ? Number(before) : undefined,
            afterTs: after ? Number(after) : undefined,
            limit: Number.isFinite(limit) ? limit : 50
          });
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        case "pending": {
          const limit = Number(flag("limit", "100"));
          const out = await listPendingReferences(Number.isFinite(limit) ? limit : 100);
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        case "mark-uploaded": {
          const id = req("id");
          const uploaded = !has("no");
          await markReferenceUploaded(id, uploaded);
          console.log(`marked ${id} uploaded=${uploaded}`);
          break;
        }
        default:
          die(`usage:
  reference create  --ref <name> [--session S] [--ts now|<ms>]
  reference nearest --ts now|<ms> [--ref r] [--session s]
  reference prev    --ts <ms> [--ref r] [--session s]
  reference next    --ts <ms> [--ref r] [--session s]
  reference list    [--ref r] [--session s] [--before ms] [--after ms] [--limit 50]
  reference pending [--limit 100]
  reference mark-uploaded --id <reference-id> [--no]`);
      }
      break;
    }

    case "opening": {
      if (sub === "get") {
        const base = req("base");
        const out = await getOpeningFromDb({
          base,
          quote: flag("quote", "USDT")!,
          window: flag("window", "1h")!,
          appSessionId: flag("session") ?? undefined
        });
        console.log(JSON.stringify(out, null, 2));
      } else if (sub === "ensure") {
        const base = req("base");
        const priceStr = req("price");
        const tsStr = flag("ts", "now")!;
        const price = Number(priceStr);
        if (!Number.isFinite(price)) die("invalid --price");
        const t = tsStr === "now" ? Date.now() : Number(tsStr);
        if (!Number.isFinite(t)) die("invalid --ts");
        const out = await ensureOpening(
          { base, quote: flag("quote","USDT")!, window: flag("window","1h")!, appSessionId: flag("session") ?? undefined },
          { openingPrice: price, openingTs: t }
        );
        console.log(JSON.stringify(out, null, 2));
      } else if (sub === "clear-cache") {
        const base = flag("base");
        if (base) {
          await clearOpeningCache({
            base,
            quote: flag("quote","USDT")!,
            window: flag("window","1h")!,
            appSessionId: flag("session") ?? undefined
          });
        } else {
          clearOpeningCache();
        }
        console.log("opening cache cleared");
      } else {
        die(`usage:
  opening get          --base <B> [--quote USDT] [--window 1h] [--session S]
  opening ensure       --base <B> --price <num> [--quote USDT] [--window 1h] [--session S] [--ts now|<ms>]
  opening clear-cache  [--base B] [--quote USDT] [--window 1h] [--session S]`);
      }
      break;
    }

    case "ledger": {
      if (sub === "append") {
        const topic = req("topic");
        const event = req("event");
        const payload = flag("payload");
        const session = flag("session");
        const idem = flag("idem");
        const tsStr = flag("ts", "now")!;
        const t = tsStr === "now" ? Date.now() : Number(tsStr);
        if (!Number.isFinite(t)) die("invalid --ts");
        let json: unknown = null;
        if (payload) { try { json = JSON.parse(payload); } catch { die("payload must be valid JSON"); } }
        await appendAppLedger({
          topic,
          event,
          payload: json,
          session_id: session ?? undefined,
          idempotency_key: idem ?? undefined,
          ts_epoch_ms: t
        });
        console.log("ledger append ✅");
      } else if (sub === "tail") {
        const since = Number(flag("since", String(Date.now() - 60_000)));
        const topic = flag("topic");
        const rows = await getAppLedgerSince(Number.isFinite(since) ? since : (Date.now() - 60_000), topic ?? undefined);
        console.log(JSON.stringify(rows, null, 2));
      } else {
        die(`usage: ledger [append|tail]`);
      }
      break;
    }

    default:
      console.log(`db CLI:
  migrate
  reference  (create|nearest|prev|next|list|pending|mark-uploaded)
  opening    (get|ensure|clear-cache)
  ledger     (append|tail)
`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

