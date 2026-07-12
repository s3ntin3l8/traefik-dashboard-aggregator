import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLogs, fetchFeatures, fetchMe, fetchInstances, createInstance, updateInstance, deleteInstance, ApiError } from "./sse";

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

  const empty = { user: "", email: "", name: "", groups: "", signOutPath: "", isAdmin: false };

  it("merges the response over the empty identity defaults", async () => {
    fetchMock.mockReturnValue(jsonResponse({ user: "alice", email: "a@x.io" }));
    expect(await fetchMe()).toEqual({ ...empty, user: "alice", email: "a@x.io" });
  });

  it("carries isAdmin through from the response", async () => {
    fetchMock.mockReturnValue(jsonResponse({ user: "alice", isAdmin: true }));
    expect(await fetchMe()).toEqual({ ...empty, user: "alice", isAdmin: true });
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

describe("instance admin API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const instances = [{ name: "gateway", url: "https://10.0.0.1", insecureSkipVerify: false, source: "file" }];

  it("fetchInstances GETs /api/instances and returns the list", async () => {
    fetchMock.mockReturnValue(jsonResponse({ instances }));
    expect(await fetchInstances()).toEqual(instances);
    expect(fetchMock).toHaveBeenCalledWith("/api/instances");
  });

  it("fetchInstances throws ApiError on a non-OK response", async () => {
    fetchMock.mockReturnValue(jsonResponse({}, { ok: false, status: 500 }));
    await expect(fetchInstances()).rejects.toBeInstanceOf(ApiError);
  });

  it("createInstance POSTs the fields as JSON and returns the updated list", async () => {
    fetchMock.mockReturnValue(jsonResponse({ instances }));
    const fields = { name: "new-node", url: "https://10.0.0.5" };
    const out = await createInstance(fields);

    expect(out).toEqual(instances);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual(fields);
  });

  it("updateInstance PUTs to /api/instances/{name}, URL-encoded", async () => {
    fetchMock.mockReturnValue(jsonResponse({ instances }));
    await updateInstance("weird name/1", { name: "weird name/1", url: "https://x" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/weird%20name%2F1");
    expect(opts.method).toBe("PUT");
  });

  it("deleteInstance DELETEs to /api/instances/{name}", async () => {
    fetchMock.mockReturnValue(jsonResponse({ instances: [] }));
    await deleteInstance("gateway");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/gateway");
    expect(opts.method).toBe("DELETE");
  });

  it("surfaces the server's {error} message via ApiError on failure", async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: "forbidden: admin group required" }, { ok: false, status: 403 }));
    try {
      await createInstance({ name: "x", url: "https://x" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).message).toBe("forbidden: admin group required");
    }
  });
});
