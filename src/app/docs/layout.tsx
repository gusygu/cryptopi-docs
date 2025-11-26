// src/app/docs/layout.tsx
import type { ReactNode } from "react";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        {children}
      </div>
    </div>
  );
}
