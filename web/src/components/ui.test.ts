import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeHref, timeAgo, clockHMS, instOK } from "./ui";

describe("safeHref", () => {
  beforeEach(() => {
    // safeHref resolves relative URLs against window.location.origin, which is
    // absent in the node test env — stub a minimal window.
    vi.stubGlobal("window", { location: { origin: "http://example.test" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("passes through http and https URLs", () => {
    expect(safeHref("http://a.com")).toBe("http://a.com");
    expect(safeHref("https://a.com/x?y=1")).toBe("https://a.com/x?y=1");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<b>x</b>")).toBeUndefined();
  });

  it("returns undefined for empty, null, or undefined input", () => {
    expect(safeHref("")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it("allows relative paths (resolve to http origin) but rejects non-http schemes", () => {
    // "/foo" resolves to http://example.test/foo (allowed protocol) → unchanged.
    expect(safeHref("/foo")).toBe("/foo");
    // mailto: keeps its own scheme → rejected.
    expect(safeHref("mailto:x@y.com")).toBeUndefined();
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const now = () => Date.now();

  it("says 'just now' under 5 seconds", () => {
    expect(timeAgo(now() - 2_000)).toBe("just now");
  });
  it("reports seconds under a minute", () => {
    expect(timeAgo(now() - 30_000)).toBe("30s ago");
  });
  it("reports minutes under an hour", () => {
    expect(timeAgo(now() - 5 * 60_000)).toBe("5m ago");
  });
  it("reports hours beyond an hour", () => {
    expect(timeAgo(now() - 3 * 3_600_000)).toBe("3h ago");
  });
});

describe("clockHMS", () => {
  it("formats a timestamp as 24-hour HH:MM:SS", () => {
    // Construct from explicit local components so the assertion is TZ-stable.
    const ts = new Date(2026, 0, 1, 13, 5, 9).getTime();
    expect(clockHMS(ts)).toBe("13:05:09");
  });
});

describe("instOK", () => {
  it("matches everything when the filter is empty/null/undefined", () => {
    expect(instOK(null, "edge")).toBe(true);
    expect(instOK(undefined, "edge")).toBe(true);
    expect(instOK([], "edge")).toBe(true);
  });
  it("matches only listed instances otherwise", () => {
    expect(instOK(["edge", "core"], "edge")).toBe(true);
    expect(instOK(["edge", "core"], "leaf")).toBe(false);
  });
});
