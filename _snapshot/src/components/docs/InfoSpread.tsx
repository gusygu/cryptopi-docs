import React from "react";

export type InfoPiece = {
  id: string;
  title: string;
  body?: React.ReactNode;
  definitions?: Array<{ term: string; desc: React.ReactNode }>;
};

export default function InfoSpread({
  pieces,
  columns = 2,
  className = "",
}: {
  pieces: InfoPiece[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const colCls =
    columns === 3
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      : columns === 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1";

  return (
    <div className={["grid gap-4", colCls, className].join(" ")}>
      {pieces.map((p) => (
        <article key={p.id} id={p.id} className="cp-card">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{p.title}</h3>
            <a
              href={`#${p.id}`}
              className="text-[11px] cp-subtle hover:underline"
              title="Anchor link"
            >
              #
            </a>
          </header>

          {p.body ? <div className="text-sm text-zinc-300">{p.body}</div> : null}

          {p.definitions?.length ? (
            <dl className="mt-2 space-y-2">
              {p.definitions.map(({ term, desc }) => (
                <div key={term} className="rounded-md border cp-border p-2">
                  <dt className="text-[11px] font-mono cp-subtle mb-1">{term}</dt>
                  <dd className="text-sm text-zinc-200">{desc}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </article>
      ))}
    </div>
  );
}
