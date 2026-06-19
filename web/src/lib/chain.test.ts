import { describe, it, expect } from "vitest";
import { resolveChainMembers } from "./chain";
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
