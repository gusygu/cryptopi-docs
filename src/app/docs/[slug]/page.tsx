// src/app/docs/[slug]/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

import {
  DOCS,
  DOC_CATEGORIES,
  getDocBySlug,
  getDocsByCategory,
} from "@/content/docsIndex";
import { renderMarkdownFile } from "@/lib/markdown";

type Params = { slug: string };

export async function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata(
  { params }: { params: Params },
): Promise<Metadata> {
  const meta = getDocBySlug(params.slug);
  if (!meta) return { title: "Docs" };

  const cat = DOC_CATEGORIES[meta.category];
  return {
    title: `${meta.title} — Docs`,
    description: meta.short || cat?.label,
  };
}

export default async function DocPage({ params }: { params: Params }) {
  const docMeta = getDocBySlug(params.slug);

  if (!docMeta) {
    return (
      <div className="p-6 text-sm">
        <p className="text-red-300">Unknown document.</p>
        <Link href="/docs" className="mt-2 inline-block text-emerald-300 underline">
          Back to docs index
        </Link>
      </div>
    );
  }

  const html = await renderMarkdownFile(docMeta.file);

  const siblings = getDocsByCategory(docMeta.category);

  return (
    <div className="flex w-full flex-col gap-6 md:flex-row">
      {/* Left: category sidebar with siblings */}
      <aside className="w-full max-w-xs space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            {DOC_CATEGORIES[docMeta.category].label}
          </div>
          <h1 className="text-xl font-semibold">{docMeta.title}</h1>
          <p className="mt-1 text-xs text-zinc-400">{docMeta.short}</p>
        </div>

        <nav className="space-y-1">
          {siblings.map((d) => (
            <Link
              key={d.id}
              href={`/docs/${d.slug}`}
              className={`flex flex-col rounded-md px-2 py-1 text-sm hover:bg-white/5 ${
                d.slug === docMeta.slug ? "bg-white/10" : ""
              }`}
            >
              <span>{d.title}</span>
              <span className="text-[11px] text-zinc-500">{d.short}</span>
            </Link>
          ))}
        </nav>

        <Link
          href="/docs"
          className="inline-flex items-center text-[11px] text-zinc-500 hover:text-zinc-200"
        >
          ← All docs
        </Link>
      </aside>

      {/* Right: markdown-rendered doc */}
      <article className="prose prose-invert max-w-none flex-1 rounded-xl border border-white/10 bg-neutral-900/60 p-5 prose-pre:bg-black/50 prose-code:text-emerald-300 prose-a:text-emerald-300">
        { }
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
