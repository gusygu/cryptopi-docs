"use client";

import React from "react";

/** ---------- Types ---------- */
export type Definition = {
  name: string;
  brief: string;
  details?: string;
};

export type SectionSpec = {
  id: string;
  title: string;
  content: React.ReactNode;
  span?: "full" | "half"; // grid span hint
};

/** ---------- Term (hover tooltip) ---------- */
export function Term({
  name,
  def,
}: {
  name: string;
  def: Definition | undefined;
}) {
  if (!def) {
    return (
      <span className="underline decoration-dotted cursor-help" title={name}>
        {name}
      </span>
    );
  }
  return (
    <span className="relative group inline-flex items-center">
      <span
        className="underline decoration-dotted cursor-help"
        aria-describedby={`tip-${def.name}`}
      >
        {name}
      </span>
      <span
        id={`tip-${def.name}`}
        role="tooltip"
        className="pointer-events-none invisible group-hover:visible absolute z-20 top-full left-0 mt-1 w-72 rounded-md border cp-border bg-[#0f141a] p-2 shadow-lg text-[11px] text-zinc-200"
      >
        <span className="block text-xs font-medium text-zinc-100 mb-1">
          {def.name}
        </span>
        <span className="block">{def.brief}</span>
        {def.details ? (
          <span className="block opacity-80 mt-1">{def.details}</span>
        ) : null}
      </span>
    </span>
  );
}

/** ---------- Glossary (card) ---------- */
export function Glossary({ defs }: { defs: Definition[] }) {
  if (!defs?.length) return null;
  return (
    <div className="cp-card">
      <div className="text-sm font-medium mb-2">Glossary</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {defs.map((d) => (
          <div key={d.name} className="rounded-md border cp-border p-2">
            <div className="text-xs font-medium">{d.name}</div>
            <div className="text-sm">{d.brief}</div>
            {d.details ? (
              <div className="text-[11px] cp-subtle mt-1">{d.details}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** ---------- InfoSpread: split content across the page ---------- */
export function InfoSpread({
  sections,
  defs,
  anchorNav = true,
}: {
  sections: SectionSpec[];
  defs?: Definition[];
  anchorNav?: boolean;
}) {
  return (
    <div className="space-y-6">
      {anchorNav && sections.length > 1 ? (
        <nav className="cp-card">
          <div className="text-xs cp-subtle mb-2">On this page</div>
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="cp-pill hover:brightness-110 transition"
              >
                {s.title}
              </a>
            ))}
          </div>
        </nav>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className={`cp-card ${s.span === "full" ? "md:col-span-2" : ""}`}
          >
            <h2 className="text-sm font-semibold mb-2">{s.title}</h2>
            <div className="text-sm text-zinc-200">{s.content}</div>
          </section>
        ))}
      </div>

      {defs?.length ? <Glossary defs={defs} /> : null}
    </div>
  );
}

/** ---------- Sponsor Box (tiny input at bottom) ---------- */
export function SponsorBox({
  action,
  placeholder = "ref code / handle / short note",
  note = "If you were invited/sponsored or acquired access via achats livre, leave a note.",
}: {
  action: (formData: FormData) => Promise<any>; // server action
  placeholder?: string;
  note?: string;
}) {
  return (
    <form action={action} className="cp-card">
      <div className="mb-2 text-sm font-medium">Sponsor</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          name="sponsor"
          className="rounded-md bg-[#0f141a] border cp-border px-2 py-2 text-sm"
          placeholder={placeholder}
        />
        <button className="btn btn-emerald text-sm" type="submit">
          Save
        </button>
      </div>
      <div className="mt-1 text-[11px] cp-subtle">{note}</div>
    </form>
  );
}
