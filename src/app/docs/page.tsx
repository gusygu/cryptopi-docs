// src/app/docs/page.tsx
import Link from "next/link";
import { DOC_CATEGORIES, DOCS, DEFAULT_DOC_SLUG } from "@/content/docsIndex";

import { requireUserSession } from "@/app/(server)/auth/session";

export default async function DocsHomePage() {
  const session = await requireUserSession();

  // agora essa página só carrega se estiver logado
  // 'session.email' está disponível aqui

  const sortedCategories = Object.entries(DOC_CATEGORIES).sort(
    (a, b) => a[1].order - b[1].order,
  );

  return (
    <div className="flex w-full flex-col gap-6 md:flex-row">
      {/* Left: categories + docs list */}
      <aside className="w-full max-w-xs space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Docs</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Core client semantics, dev helpers, and research notes.
          </p>
        </div>

        <nav className="space-y-4">
          {sortedCategories.map(([catId, cat]) => {
            const docs = DOCS.filter((d) => d.category === catId).sort(
              (a, b) => a.order - b.order,
            );

            return (
              <div key={catId}>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {cat.label}
                </div>
                <ul className="mt-1 space-y-1">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/docs/${d.slug}`}
                        className="flex flex-col rounded-md px-2 py-1 text-sm hover:bg-white/5"
                      >
                        <span>{d.title}</span>
                        <span className="text-[11px] text-zinc-500">{d.short}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
          <div className="text-xs font-semibold text-emerald-300">
            Start here
          </div>
          <p className="mt-1 text-xs text-emerald-100/80">
            New to the client? Jump straight to the{" "}
            <Link
              href={`/docs/${DEFAULT_DOC_SLUG}`}
              className="underline decoration-dotted underline-offset-2"
            >
              Client Guide
            </Link>
            .
          </p>
        </div>
      </aside>

      {/* Right: just a welcome screen, the actual doc content lives in [slug]/page */}
      <section className="flex-1 rounded-xl border border-white/10 bg-neutral-900/40 p-4 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Welcome to the CryptoPill docs</h2>
        <p className="mt-2 text-zinc-300">
          Use the navigation on the left to explore client semantics, dev setup,
          and research notes. Each document opens in a focused view with the same
          cobalt / tetrahedron visual language as the rest of the app.
        </p>
      </section>
    </div>
  );
}
