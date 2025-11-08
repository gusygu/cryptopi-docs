// somewhere rendered client-side once: src/core/poller/boot.client.ts
"use client";
import { ClientPoller } from "@/core/poller/poller.client";

let started = false;
export function useBootPoller() {
  if (started || typeof window === "undefined") return;
  started = true;
  const p = new ClientPoller({
    events: ["cycle"], 
    periodMs: 60_000,                   // local fallback if SSE drops
    sseUrl: "/api/poller",
    appSessionId: process.env.NEXT_PUBLIC_APP_SESSION_ID ?? null,
    channelName: "app-universal-clock"
  });
  p.start();
}
