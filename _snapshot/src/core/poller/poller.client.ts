// src/core/poller/poller.client.ts
import { Metronome } from "./tempo";
import type { PollKind, PollTick } from "@/core/pipelines/types";

export type ClientPollerOpts = {
  /** Which server events (scales) to listen to; default ["cycle"] */
  events?: PollKind[];
  /** Period for local fallback (used for the FIRST event only) */
  periodMs: number;
  sseUrl?: string;             // e.g. "/api/poller"
  alignToMs?: number;          // for local fallback
  appSessionId?: string | null;
  channelName?: string;        // BroadcastChannel name
};

export class ClientPoller {
  private opts: ClientPollerOpts;
  private bc?: BroadcastChannel;
  private listeners = new Set<(t: PollTick) => void>();
  private local?: Metronome;
  private sse?: EventSource;

  constructor(opts: ClientPollerOpts) {
    this.opts = { events: opts.events?.length ? opts.events : ["cycle"], ...opts, channelName: opts.channelName ?? "app-universal-clock" };

    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.bc = new BroadcastChannel(this.opts.channelName!);
      this.bc.onmessage = (ev) => {
        const t = ev.data as PollTick;
        this.emit(t);
      };
    }
  }

  on(fn: (t: PollTick) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(t: PollTick) {
    for (const fn of this.listeners) fn(t);
    if (this.bc) this.bc.postMessage(t);
  }

  start() {
    const events = this.opts.events!;
    // Prefer server SSE if available
    if (this.opts.sseUrl && typeof window !== "undefined" && "EventSource" in window) {
      this.sse = new EventSource(this.opts.sseUrl, { withCredentials: false });

      // listen to all selected scales; keep "tick" for backwards compat if you had it
      const names = [...new Set([...events, "tick" as any])];
      for (const name of names) {
        this.sse.addEventListener(name as any, (ev: MessageEvent) => {
          try {
            const t = JSON.parse(ev.data) as PollTick;
            // inject scale when backend sent "tick" only
            if (!t.scale && name !== "tick") t.scale = name as PollKind;
            this.emit(t);
          } catch {}
        });
      }

      this.sse.onerror = () => { this.startLocalFallback(); };
    } else {
      this.startLocalFallback();
    }
  }

  private startLocalFallback() {
    if (this.local?.isRunning()) return;
    // fallback for the first requested event only (typical = "cycle")
    const periodMs = this.opts.periodMs;
    this.local = new Metronome({
      periodMs,
      alignToMs: this.opts.alignToMs,
      appSessionId: this.opts.appSessionId ?? null,
      label: "client-fallback",
      immediate: true
    });
    this.local.on((t) => this.emit({ ...t, scale: this.opts.events![0] }));
    this.local.start();
  }

  stop() {
    try { this.sse?.close(); } catch {}
    this.local?.stop();
    if (this.bc) { try { this.bc.close(); } catch {} }
  }
}
