"use client";
import React from "react";

/** Full-page chrome with layered background + container spacing. */
export default function AppChrome({
  title,
  subtitle,
  right,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh text-slate-200 antialiased">
      {/* background layers */}
      <div className="pointer-events-none fixed inset-0 -z-20">
        {/* deep radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(1000px_600px_at_50%_-10%,rgba(79,70,229,0.18),transparent_60%)]" />
        {/* subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.15) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        {/* film grain */}
        <div
          className="absolute inset-0 opacity-[0.06] mix-blend-soft-light"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")",
            backgroundSize: "256px 256px",
          }}
        />
      </div>

      {/* header */}
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-slate-900/45 border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-5 py-4 flex items-center gap-4">
          <div className="flex-1">
            {title ? (
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                <span className="bg-gradient-to-r from-indigo-300 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
                  {title}
                </span>
              </h1>
            ) : null}
            {subtitle ? (
              <p className="mt-1 text-xs md:text-sm text-slate-400">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">{right}</div>
        </div>
      </header>

      {/* content */}
      <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
    </div>
  );
}
