import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLogs, fetchFeatures, fetchMe } from "./sse";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return Promise.resolve({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("fetchLogs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function calledQuery(): URLSearchParams {
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith("/api/logs/query?")).toBe(true);
    return new URLSearchParams(url.split("?")[1]);
  }

  it("builds the query string from every param and returns entries", async () => {
    const entries = [{ id: "a", ts: 1, kind: "access", level: "info", instance: "edge" }];
    fetchMock.mockReturnValue(jsonResponse({ entries }));

    const out = await fetchLogs({ instance: "edge", startMs: 100, endMs: 200, limit: 50 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const q = calledQuery();
    expect(q.get("instance")).toBe("edge");
    expect(q.get("start")).toBe("100");
    expect(q.get("end")).toBe("200");
    expect(q.get("limit")).toBe("50");
    expect(out).toEqual(entries);
  });

  it("omits instance and limit when they are absent", async () => {
    fetchMock.mockReturnValue(jsonResponse({ entries: [] }));

    await fetchLogs({ instance: null, startMs: 1, endMs: 2 });

    const q = calledQuery();
    expect(q.has("instance")).toBe(false);
    expect(q.has("limit")).toBe(false);
    expect(q.get("start")).toBe("1");
    expect(q.get("end")).toBe("2");
  });

  it("returns an empty array when the response has no entries", async () => {
    fetchMock.mockReturnValue(jsonResponse({}));
    expect(await fetchLogs({ startMs: 1, endMs: 2 })).toEqual([]);
  });

  it("throws with the status code on a non-OK response", async () => {
    fetchMock.mockReturnValue(jsonResponse({}, { ok: false, status: 503 }));
    await expect(fetchLogs({ startMs: 1, endMs: 2 })).rejects.toThrow("logs query failed: 503");
  });
});

describe("fetchFeatures", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed /api/config payload", async () => {
    fetchMock.mockReturnValue(jsonResponse({ lokiEnabled: true, authentikEnabled: true, version: "1.2.3" }));
    const f = await fetchFeatures();
    expect(fetchMock).toHaveBeenCalledWith("/api/config");
    expect(f).toEqual({ lokiEnabled: true, authentikEnabled: true, version: "1.2.3" });
  });

  it("falls back to all-disabled when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await fetchFeatures()).toEqual({ lokiEnabled: false, authentikEnabled: false });
  });
});

describe("fetchMe", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const empty = { user: "", email: "", name: "", groups: "", signOutPath: "" };

  it("merges the response over the empty identity defaults", async () => {
    fetchMock.mockReturnValue(jsonResponse({ user: "alice", email: "a@x.io" }));
    expect(await fetchMe()).toEqual({ ...empty, user: "alice", email: "a@x.io" });
  });

  it("returns the empty identity on a non-OK response", async () => {
    fetchMock.mockReturnValue(jsonResponse({}, { ok: false, status: 401 }));
    expect(await fetchMe()).toEqual(empty);
  });

  it("returns the empty identity when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await fetchMe()).toEqual(empty);
  });
});
