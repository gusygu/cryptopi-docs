"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/matrices", label: "Matrices" },
  { href: "/dynamics", label: "Dynamics" },
  { href: "/settings", label: "Settings" },
  { href: "/info", label: "Info" },
  { href: "/login", label: "Access" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight text-emerald-200">
            CryptoPi Dynamics
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 text-sm">
            {links.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md border px-3 py-1.5 transition ${
                    active
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100"
                      : "border-transparent text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-100"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-white/10 bg-black/30 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-zinc-400">
          <span>© {year} CryptoPi Dynamics</span>
          <span>Hosted app build · Emerald &amp; Silver motif</span>
        </div>
      </footer>
    </div>
  );
}
