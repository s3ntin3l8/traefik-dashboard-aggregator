import { describe, it, expect } from "vitest";
import { resolveChainMembers, resolveChainTree } from "./chain";
import type { Middleware } from "./types";

function mw(overrides: Partial<Middleware>): Middleware {
  return {
    id: "inst:name",
    name: "name",
    fullName: "name@file",
    type: "headers",
    provider: "file",
    instance: "inst",
    config: {},
    usedBy: 0,
    usedByRouters: [],
    ...overrides,
  };
}

const headersMw = mw({
  name: "headers-secure",
  fullName: "headers-secure@file",
  type: "headers",
  provider: "file",
  instance: "inst",
});

const ratelimitMw = mw({
  name: "ratelimit",
  fullName: "ratelimit@file",
  type: "ratelimit",
  provider: "file",
  instance: "inst",
});

// chain-a references:
//   "headers-secure"   — bare name (no @provider), resolved via fallback
//   "ratelimit@file"   — full name with @provider, resolved directly
const basicChain = mw({
  name: "chain-a",
  fullName: "chain-a@file",
  type: "chain",
  provider: "file",
  instance: "inst",
  config: { middlewares: ["headers-secure", "ratelimit@file"] },
});

describe("resolveChainMembers", () => {
  it("returns [] for a non-chain middleware", () => {
    expect(resolveChainMembers(headersMw, [headersMw])).toEqual([]);
  });

  it("returns [] when config.middlewares is missing", () => {
    const c = mw({ type: "chain", config: {} });
    expect(resolveChainMembers(c, [])).toEqual([]);
  });

  it("returns [] when config.middlewares is not an array", () => {
    const c = mw({ type: "chain", config: { middlewares: "headers-secure" } });
    expect(resolveChainMembers(c, [headersMw])).toEqual([]);
  });

  it("resolves a member given with the full @provider suffix", () => {
    const result = resolveChainMembers(basicChain, [headersMw, ratelimitMw]);
    expect(result[1].name).toBe("ratelimit@file");
    expect(result[1].mw).toBe(ratelimitMw);
  });

  it("resolves a bare member name via @provider fallback", () => {
    const result = resolveChainMembers(basicChain, [headersMw, ratelimitMw]);
    expect(result[0].name).toBe("headers-secure");
    expect(result[0].mw).toBe(headersMw);
  });

  it("returns { name, mw: undefined } for an unknown member", () => {
    const c = mw({
      type: "chain",
      provider: "file",
      instance: "inst",
      config: { middlewares: ["missing@docker"] },
    });
    const result = resolveChainMembers(c, [headersMw]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("missing@docker");
    expect(result[0].mw).toBeUndefined();
  });

  it("scopes resolution to the same instance", () => {
    const otherInst = mw({
      name: "headers-secure",
      fullName: "headers-secure@file",
      instance: "other-inst",
    });
    const result = resolveChainMembers(basicChain, [otherInst]);
    expect(result[0].mw).toBeUndefined();
  });

  it("is case-insensitive on the type field", () => {
    const c = mw({
      type: "Chain",
      provider: "file",
      instance: "inst",
      config: { middlewares: ["headers-secure@file"] },
    });
    expect(resolveChainMembers(c, [headersMw])[0].mw).toBe(headersMw);
  });

  it("preserves ordering of the member list", () => {
    const result = resolveChainMembers(basicChain, [ratelimitMw, headersMw]);
    expect(result.map((r) => r.name)).toEqual(["headers-secure", "ratelimit@file"]);
  });
});

// ── resolveChainTree ───────────────────────────────────────────────────────────

const nestedChain = mw({
  name: "outer",
  fullName: "outer@file",
  type: "chain",
  provider: "file",
  instance: "inst",
  config: { middlewares: ["inner-chain@file", "headers-secure@file"] },
});

const innerChain = mw({
  name: "inner-chain",
  fullName: "inner-chain@file",
  type: "chain",
  provider: "file",
  instance: "inst",
  config: { middlewares: ["ratelimit@file"] },
});

describe("resolveChainTree", () => {
  it("flat chain produces leaf nodes with no children", () => {
    const result = resolveChainTree(basicChain, [headersMw, ratelimitMw]);
    expect(result).toHaveLength(2);
    expect(result[0].children).toBeUndefined();
    expect(result[0].cycle).toBeUndefined();
    expect(result[1].children).toBeUndefined();
  });

  it("nested chain member gets a children array", () => {
    const candidates = [innerChain, ratelimitMw, headersMw];
    const result = resolveChainTree(nestedChain, candidates);
    expect(result[0].mw).toBe(innerChain);
    expect(result[0].children).toBeDefined();
    expect(result[0].children![0].mw).toBe(ratelimitMw);
    // second direct member is a leaf
    expect(result[1].children).toBeUndefined();
  });

  it("cycle in chain marks the node cycle:true and does not recurse further", () => {
    // A -> B -> A is a cycle; A is the root so its key seeds the path
    const chainA = mw({
      name: "chain-a",
      fullName: "chain-a@file",
      type: "chain",
      provider: "file",
      instance: "inst",
      config: { middlewares: ["chain-b@file"] },
    });
    const chainB = mw({
      name: "chain-b",
      fullName: "chain-b@file",
      type: "chain",
      provider: "file",
      instance: "inst",
      config: { middlewares: ["chain-a@file"] },
    });
    const result = resolveChainTree(chainA, [chainA, chainB]);
    // chain-b expands...
    expect(result[0].mw).toBe(chainB);
    expect(result[0].children).toBeDefined();
    // ...and chain-a inside chain-b is a cycle
    const inner = result[0].children![0];
    expect(inner.mw).toBe(chainA);
    expect(inner.cycle).toBe(true);
    expect(inner.children).toBeUndefined();
  });

  it("unresolved member still appears with mw: undefined and no children", () => {
    const result = resolveChainTree(basicChain, []); // empty candidates
    expect(result).toHaveLength(2);
    result.forEach((n) => {
      expect(n.mw).toBeUndefined();
      expect(n.children).toBeUndefined();
    });
  });

  it("respects maxDepth: stops recursing and returns a leaf at the cap", () => {
    const candidates = [innerChain, ratelimitMw, headersMw];
    // depth=0 means "do not recurse into any chain members" — chains are returned as leaves
    const result = resolveChainTree(nestedChain, candidates, 0);
    expect(result[0].mw).toBe(innerChain);
    expect(result[0].children).toBeUndefined();
    expect(result[0].cycle).toBeUndefined();
  });

  it("sibling chains that are the same middleware both expand independently (no DFS bleed)", () => {
    // outer -> [inner-chain, inner-chain] — the same chain listed twice
    const doubleChain = mw({
      name: "double",
      fullName: "double@file",
      type: "chain",
      provider: "file",
      instance: "inst",
      config: { middlewares: ["inner-chain@file", "inner-chain@file"] },
    });
    const candidates = [innerChain, ratelimitMw];
    const result = resolveChainTree(doubleChain, candidates);
    // Both entries should be expanded (not treated as cycle just because the first ran)
    expect(result[0].children).toBeDefined();
    expect(result[1].children).toBeDefined();
  });
});
