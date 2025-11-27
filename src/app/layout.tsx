// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import HomeBar from "@/components/ui/HomeBar";

const num = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-num",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CryptoPi Dynamics",
  description: "Matrices & dynamics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={num.variable}>
      <body className="antialiased bg-carbon-950 text-slate-100">
        <div className="flex min-h-dvh flex-col md:flex-row">
          <HomeBar className="md:w-72 md:flex-shrink-0" />
          <main className="flex-1 w-full">{children}</main>
        </div>
      </body>
    </html>
  );
}
