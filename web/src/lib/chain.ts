// Resolves a chain middleware's member list against a flat middleware collection.
// Mirrors the lookup used by internal/aggregator/authentik.go:67-72:
//   chain entries may omit the @provider suffix, so we try both
//   fullName === name and fullName === name@provider, scoped per instance.
import type { Middleware } from "./types";

export interface ChainMember {
  name: string;
  mw?: Middleware;
}

// Returns the ordered list of direct chain members.
// Returns [] when:
//   - m.type is not "chain" (case-insensitive)
//   - m.config.middlewares is absent or not an array
export function resolveChainMembers(m: Middleware, candidates: Middleware[]): ChainMember[] {
  if (m.type?.toLowerCase() !== "chain") return [];
  const names = m.config?.middlewares;
  if (!Array.isArray(names)) return [];
  return (names as unknown[])
    .filter((n): n is string => typeof n === "string")
    .map((name) => ({
      name,
      mw:
        candidates.find((x) => x.instance === m.instance && x.fullName === name) ??
        candidates.find((x) => x.instance === m.instance && x.fullName === `${name}@${m.provider}`),
    }));
}

// A node in the expanded chain tree.
export interface ChainNode {
  name: string;       // raw name as written in config.middlewares
  mw?: Middleware;    // resolved middleware (undefined if not in snapshot)
  children?: ChainNode[];  // set when mw is itself a chain that was recursed into
  cycle?: boolean;    // set when mw is a chain that appeared on the current path (cycle detected)
}

// Expands a chain into a recursive tree of its members.
// Cycle-guarded: a chain re-encountered on the current path is marked cycle: true and not
// further expanded (siblings can still expand the same chain independently).
// Depth-capped at maxDepth (default 5): a chain at the cap is returned with mw set but no
// children — its raw config (showing the member list) renders as the leaf.
export function resolveChainTree(
  m: Middleware,
  candidates: Middleware[],
  maxDepth = 5,
): ChainNode[] {
  const path = new Set([`${m.instance}\0${m.fullName}`]);
  return expand(m, candidates, maxDepth, path);
}

function expand(
  m: Middleware,
  candidates: Middleware[],
  depth: number,
  path: Set<string>,
): ChainNode[] {
  return resolveChainMembers(m, candidates).map(({ name, mw }) => {
    if (!mw || mw.type?.toLowerCase() !== "chain" || depth <= 0) {
      return { name, mw };
    }
    const key = `${mw.instance}\0${mw.fullName}`;
    if (path.has(key)) {
      return { name, mw, cycle: true };
    }
    path.add(key);
    const children = expand(mw, candidates, depth - 1, path);
    path.delete(key);
    return { name, mw, children };
  });
}
