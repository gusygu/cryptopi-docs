// src/app/cin/page.tsx
import CinAuxClient from "@/components/features/cin-aux/CinAuxClient";

import { requireUserSession } from "@/app/(server)/auth/session";

export default async function CinPage() {
  const session = await requireUserSession();

  // agora essa página só carrega se estiver logado
  // 'session.email' está disponível aqui

  return (
    <main className="min-h-screen w-full bg-slate-50">
      <CinAuxClient />
    </main>
  );
}
