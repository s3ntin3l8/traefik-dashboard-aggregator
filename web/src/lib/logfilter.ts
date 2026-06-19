// Pure log filtering/aggregation, lifted out of views/Logs.tsx so the filter
// chain (level / kind / instance / text / time-window) can be unit-tested
// without the SSE tail and histogram machinery.
import type { LogEntry } from "./types";

export interface LogFilters {
  level?: string | null;
  kind?: string | null;
  instances?: string[]; // multi-select; empty/undefined = all instances
  search?: string; // local filter expression
  globalSearch?: string; // app-wide search box
  winStart: number;
  winEnd: number;
}

// The searchable text projection for a log line — access logs flatten their
// request fields; system logs use the message plus structured fields.
export function logText(l: LogEntry): string {
  if (l.kind === "access") return `${l.method} ${l.path} ${l.status} ${l.host} ${l.clientIP} ${l.app} ${l.router} ${l.service}`;
  return `${l.msg} ${l.app} ${JSON.stringify(l.fields || {})}`;
}

// Everything except the level check (so level counts can reuse it).
function passesBase(l: LogEntry, f: LogFilters): boolean {
  if (l.ts < f.winStart || l.ts > f.winEnd) return false;
  if (f.kind && l.kind !== f.kind) return false;
  if (f.instances && f.instances.length > 0 && !f.instances.includes(l.instance)) return false;
  const txt = logText(l).toLowerCase();
  const lq = (f.search || "").trim().toLowerCase();
  if (lq && !txt.includes(lq)) return false;
  const gq = (f.globalSearch || "").trim().toLowerCase();
  if (gq && !txt.includes(gq)) return false;
  return true;
}

export function filterLogs(logs: LogEntry[], f: LogFilters): LogEntry[] {
  return logs.filter((l) => {
    if (f.level && l.level !== f.level) return false;
    return passesBase(l, f);
  });
}

// Per-level counts over the window, ignoring the level filter itself (the chips
// always show every level's count). Seeds info/warning/error at 0.
export function countLogLevels(logs: LogEntry[], f: LogFilters): Record<string, number> {
  const m: Record<string, number> = { info: 0, warning: 0, error: 0 };
  for (const l of logs) {
    if (!passesBase(l, f)) continue;
    m[l.level] = (m[l.level] || 0) + 1;
  }
  return m;
}
