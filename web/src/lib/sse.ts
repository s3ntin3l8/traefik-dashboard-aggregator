import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

// useSnapshot subscribes to the backend SSE stream and returns the latest
// aggregated snapshot. It falls back to a one-shot fetch if SSE fails.
export function useSnapshot(): { snapshot: Snapshot | null; connected: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    // initial fetch so the UI paints fast even before the first SSE frame
    fetch("/api/snapshot")
      .then((r) => r.json())
      .then((d) => !cancelled && setSnapshot(d))
      .catch(() => {});

    const es = new EventSource("/api/events");
    esRef.current = es;
    es.addEventListener("snapshot", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data));
        setConnected(true);
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

  return { snapshot, connected };
}

// fetchLogs queries the backend Loki proxy for a time window.
export async function fetchLogs(params: {
  query?: string;
  startMs: number;
  endMs: number;
  limit?: number;
}): Promise<import("./types").LogEntry[]> {
  const q = new URLSearchParams();
  if (params.query) q.set("query", params.query);
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
