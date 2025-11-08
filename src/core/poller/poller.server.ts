// src/core/poller/poller.server.ts
import type { IncomingMessage, ServerResponse } from "http";
import type { ScalesSettings, PollTick } from "@/core/pipelines/types";
import { PollHub } from "./scales";

export type ServerPollerOpts = {
  scales: ScalesSettings;
  appSessionId?: string | null;
};

export class ServerPoller {
  private clients = new Set<ServerResponse>();
  private hub: PollHub;

  constructor(opts: ServerPollerOpts) {
    this.hub = new PollHub(opts.scales, { appSessionId: opts.appSessionId ?? null, label: "server-hub" });
    for (const scale of ["continuous","sampling","cycle","window","loop","reference"] as const) {
      this.hub.on(scale, (t) => this.broadcast(scale, t));
    }
  }

  start() { this.hub.start(); }
  stop()  { this.hub.stop(); for (const c of this.clients) try { c.end(); } catch {} this.clients.clear(); }

  /** Minimal SSE handler (Express-compatible) */
  sseHandler = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    this.clients.add(res);
    res.on("close", () => { this.clients.delete(res); });
  };

  private broadcast(event: string, t: PollTick) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(t)}\n\n`;
    for (const c of this.clients) { try { c.write(payload); } catch { this.clients.delete(c); } }
  }

  triggerLoop() { this.hub.triggerLoop(); }
  triggerReference(ts: number) { this.hub.triggerReference(ts); }
}
