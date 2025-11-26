import crypto from "crypto";
import { redirect } from "next/navigation";
import { requireUserSession } from "@/app/(server)/auth/session";
import {
  getUserSettings,
  upsertWallet,
  removeWallet,
  type Wallet,
} from "@/lib/settings/store";

function validateWallet(w: Wallet): string | null {
  if (!w.symbol || !/^[A-Z0-9]{2,10}$/.test(w.symbol))
    return "Invalid symbol.";
  if (!w.address || w.address.length < 8 || w.address.length > 128)
    return "Address length seems invalid.";
  if (w.network && !/^[A-Za-z0-9\\-]{2,16}$/.test(w.network))
    return "Invalid network tag.";
  return null;
}

async function addWalletAction(form: FormData) {
  "use server";

  const session = await requireUserSession();

  const wallet: Wallet = {
    id: crypto.randomUUID(),
    label: String(form.get("label") || "").trim(),
    symbol: String(form.get("symbol") || "").trim().toUpperCase(),
    network: String(form.get("network") || "").trim(),
    address: String(form.get("address") || "").trim(),
  };

  const err = validateWallet(wallet);
  if (err) {
    redirect(`/settings/wallets?err=${encodeURIComponent(err)}`);
  }

  upsertWallet(session.email, wallet);
  redirect("/settings/wallets?ok=wallet_added");
}

async function deleteWalletAction(form: FormData) {
  "use server";

  const session = await requireUserSession();
  const id = String(form.get("walletId") || "");
  if (!id) {
    redirect("/settings/wallets?err=missing_wallet_id");
  }

  removeWallet(session.email, id);
  redirect("/settings/wallets?ok=wallet_removed");
}

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

export default async function WalletsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await requireUserSession();
  const settings = getUserSettings(session.email);
  const wallets = settings.wallets ?? [];

  const pick = (k: string) => {
    const v = searchParams?.[k];
    return Array.isArray(v) ? v[0] : v || "";
  };
  const ok = pick("ok");
  const err = pick("err");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold text-zinc-50">Wallets</h1>
      <p className="mb-4 text-sm text-zinc-400">
        Register external wallets to use in your flow and analytics.
      </p>

      {(ok || err) && (
        <div className="mb-4 text-xs">
          {ok && (
            <div className="mb-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-emerald-100">
              {ok === "wallet_added" && "Wallet added successfully."}
              {ok === "wallet_removed" && "Wallet removed successfully."}
            </div>
          )}
          {err && (
            <div className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-rose-100">
              {err}
            </div>
          )}
        </div>
      )}

      {/* Add wallet form */}
      <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Add wallet
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          Public addresses only. Never paste private keys here.
        </p>

        <form action={addWalletAction} className="grid gap-3 md:grid-cols-2">
          <label className="col-span-2 grid gap-1">
            <span className="text-xs text-zinc-400">Label (optional)</span>
            <input
              type="text"
              name="label"
              placeholder="Main Binance, Cold, etc."
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-zinc-400">Symbol</span>
            <input
              type="text"
              name="symbol"
              placeholder="BTC, ETH, USDT"
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-zinc-400">Network (optional)</span>
            <input
              type="text"
              name="network"
              placeholder="ERC20, TRC20, BEP20…"
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>

          <label className="col-span-2 grid gap-1">
            <span className="text-xs text-zinc-400">Address</span>
            <input
              type="text"
              name="address"
              placeholder="Public wallet address"
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>

          <div className="col-span-2">
            <button
              type="submit"
              className="mt-2 inline-flex items-center rounded-md border border-emerald-500/50 bg-emerald-600/70 px-4 py-2 text-xs font-medium text-emerald-50 hover:bg-emerald-500"
            >
              Add wallet
            </button>
          </div>
        </form>
      </section>

      {/* Existing wallets */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Registered wallets
        </h2>
        {wallets.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No wallets registered yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li
                key={w.id}
                className="flex flex-col justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs md:flex-row md:items-center"
              >
                <div className="space-y-1">
                  <p className="font-mono text-[11px] text-zinc-100">
                    {w.symbol}{" "}
                    {w.network && (
                      <span className="text-zinc-400">/ {w.network}</span>
                    )}
                  </p>
                  {w.label && (
                    <p className="text-[11px] text-zinc-300">{w.label}</p>
                  )}
                  <p className="break-all text-[11px] text-zinc-500">
                    {w.address}
                  </p>
                </div>
                <form action={deleteWalletAction}>
                  <input type="hidden" name="walletId" value={w.id} />
                  <button
                    type="submit"
                    className="self-start rounded-md border border-rose-500/60 bg-rose-600/20 px-3 py-1 text-[11px] text-rose-100 hover:bg-rose-600/30"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
