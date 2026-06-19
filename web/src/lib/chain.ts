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
