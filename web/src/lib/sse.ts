import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

// useSnapshot subscribes to the backend SSE stream and returns the latest
// aggregated snapshot. It falls back to a one-shot fetch if SSE fails.
//
// `authExpired` is set when the initial fetch is bounced with a 401 by an
// upstream forward-auth proxy (session expired at the edge). The proxy handles
// the actual re-login on a full navigation, so the UI just prompts a reload.
export function useSnapshot(): { snapshot: Snapshot | null; connected: boolean; authExpired: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    // initial fetch so the UI paints fast even before the first SSE frame
    fetch("/api/snapshot")
      .then((r) => {
        if (r.status === 401) {
          if (!cancelled) setAuthExpired(true);
          return null;
        }
        return r.json();
      })
      .then((d) => !cancelled && d && setSnapshot(d))
      .catch(() => {});

    const es = new EventSource("/api/events");
    esRef.current = es;
    es.addEventListener("snapshot", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data));
        setConnected(true);
        if (!cancelled) setAuthExpired(false);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return { snapshot, connected, authExpired };
}

// fetchLogs queries the backend Loki proxy for a time window. The stream
// selector is built server-side; the client may only narrow it to one instance.
export async function fetchLogs(params: {
  instance?: string | null;
  startMs: number;
  endMs: number;
  limit?: number;
}): Promise<import("./types").LogEntry[]> {
  const q = new URLSearchParams();
  if (params.instance) q.set("instance", params.instance);
  q.set("start", String(params.startMs));
  q.set("end", String(params.endMs));
  if (params.limit) q.set("limit", String(params.limit));
  const r = await fetch("/api/logs/query?" + q.toString());
  if (!r.ok) throw new Error("logs query failed: " + r.status);
  const d = await r.json();
  return d.entries || [];
}

export async function fetchFeatures(): Promise<{ lokiEnabled: boolean }> {
  try {
    const r = await fetch("/api/config");
    return await r.json();
  } catch {
    return { lokiEnabled: false };
  }
}

// Identity reflected from an upstream forward-auth proxy (e.g. authentik). All
// fields are empty when no proxy fronts the app (e.g. local dev), in which case
// the UI shows no identity block. Display-only: the app enforces no auth itself.
export type Identity = { user: string; email: string; name: string; groups: string; signOutPath: string };

export async function fetchMe(): Promise<Identity> {
  const empty: Identity = { user: "", email: "", name: "", groups: "", signOutPath: "" };
  try {
    const r = await fetch("/api/me");
    if (!r.ok) return empty;
    return { ...empty, ...(await r.json()) };
  } catch {
    return empty;
  }
}
