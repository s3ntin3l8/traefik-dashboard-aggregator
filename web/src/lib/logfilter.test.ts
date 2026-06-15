import { describe, it, expect } from "vitest";
import { logText, filterLogs, countLogLevels } from "./logfilter";
import type { LogEntry } from "./types";

function log(over: Partial<LogEntry>): LogEntry {
  return { id: Math.random().toString(36), ts: 1000, kind: "system", level: "info", instance: "edge", ...over };
}

describe("logText", () => {
  it("flattens access-log request fields", () => {
    const t = logText(log({ kind: "access", method: "GET", path: "/x", status: 200, host: "h", clientIP: "1.1.1.1", app: "app", router: "r", service: "s" }));
    expect(t).toContain("GET");
    expect(t).toContain("/x");
    expect(t).toContain("1.1.1.1");
  });

  it("uses message + serialized fields for system logs", () => {
    const t = logText(log({ kind: "system", msg: "boot done", app: "traefik", fields: { code: 7 } }));
    expect(t).toContain("boot done");
    expect(t).toContain("\"code\":7");
  });
});

const WIN = { winStart: 0, winEnd: 10_000 };

describe("filterLogs", () => {
  const logs: LogEntry[] = [
    log({ id: "a", ts: 1000, level: "info", kind: "system", instance: "edge", msg: "alpha" }),
    log({ id: "b", ts: 2000, level: "error", kind: "access", instance: "core", method: "GET", path: "/beta" }),
    log({ id: "c", ts: 3000, level: "warning", kind: "system", instance: "edge", msg: "gamma" }),
    log({ id: "d", ts: 99_999, level: "info", kind: "system", instance: "edge", msg: "future" }),
  ];

  it("keeps everything inside the window with no filters", () => {
    expect(filterLogs(logs, WIN).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("drops entries outside the time window", () => {
    expect(filterLogs(logs, WIN).some((l) => l.id === "d")).toBe(false);
  });

  it("filters by level", () => {
    expect(filterLogs(logs, { ...WIN, level: "error" }).map((l) => l.id)).toEqual(["b"]);
  });

  it("filters by kind", () => {
    expect(filterLogs(logs, { ...WIN, kind: "access" }).map((l) => l.id)).toEqual(["b"]);
  });

  it("filters by instance multi-select (empty = all)", () => {
    expect(filterLogs(logs, { ...WIN, instances: ["core"] }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLogs(logs, { ...WIN, instances: [] }).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by local and global text (case-insensitive)", () => {
    expect(filterLogs(logs, { ...WIN, search: "GAMMA" }).map((l) => l.id)).toEqual(["c"]);
    expect(filterLogs(logs, { ...WIN, globalSearch: "/BETA" }).map((l) => l.id)).toEqual(["b"]);
  });

  it("combines filters with AND", () => {
    expect(filterLogs(logs, { ...WIN, kind: "system", instances: ["edge"], search: "alpha" }).map((l) => l.id)).toEqual(["a"]);
  });
});

describe("countLogLevels", () => {
  const logs: LogEntry[] = [
    log({ ts: 1000, level: "info" }),
    log({ ts: 2000, level: "info" }),
    log({ ts: 3000, level: "warning" }),
    log({ ts: 4000, level: "error" }),
    log({ ts: 99_999, level: "error" }), // outside window
  ];

  it("counts each level within the window, ignoring the level filter", () => {
    // Passing a level filter must not change the per-level counts.
    expect(countLogLevels(logs, { ...WIN, level: "error" })).toEqual({ info: 2, warning: 1, error: 1 });
  });

  it("seeds info/warning/error at zero", () => {
    expect(countLogLevels([], WIN)).toEqual({ info: 0, warning: 0, error: 0 });
  });
});
