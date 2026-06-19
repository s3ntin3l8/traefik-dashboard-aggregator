// Pure topology logic: host extraction, /24 subnet comparison, external-backend
// resolution, and the shared router→service join used by both the topology view
// and the services table.
import type { Snapshot, Router, Service, Server } from "./types";

/** One external route: the router and the unique external IPs it points to. */
export interface ExternalRoute {
  router: Router;
  ips: string[];
}

/**
 * Pull the host portion out of a server's url or address field.
 * Handles:
 *   - "http://10.0.0.11:80"   → "10.0.0.11"  (via URL parsing)
 *   - "10.0.0.5:9000"         → "10.0.0.5"   (bare host:port)
 *   - "myservice"             → "myservice"   (bare hostname)
 * Returns null when both url and address are absent or empty.
 */
export function hostFromServer(server: Server): string | null {
  const raw = server.url || server.address;
  if (!raw) return null;
  // Full URL (http/https/tcp/…): let the parser strip scheme, port, path.
  try {
    return new URL(raw).hostname; // also strips [] brackets from IPv6
  } catch {
    // Bare "host:port" — detect by finding a trailing all-digit port segment.
    const i = raw.lastIndexOf(":");
    if (i > 0) {
      const port = raw.slice(i + 1);
      if (/^\d+$/.test(port)) return raw.slice(0, i);
    }
    return raw || null;
  }
}

/** Returns true iff s is a dotted-decimal IPv4 address (all four octets 0–255). */
export function isIPv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && parseInt(p, 10) <= 255);
}

/**
 * Returns true iff both IPs are in the same /24 block (first three octets match).
 * Callers must ensure both a and b are valid IPv4 strings (i.e. isIPv4 is true).
 */
export function sameSubnet24(a: string, b: string): boolean {
  const pa = a.split(".");
  const pb = b.split(".");
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

/**
 * Returns the unique list of backend IP addresses that are "external" to the
 * instance — meaning they are:
 *   - a dotted-decimal IPv4 (not a hostname such as "myservice:8080")
 *   - in the same /24 as instanceIP (same LAN segment, not Docker bridge ranges)
 *   - different from instanceIP itself (not a local proxy/loopback)
 *
 * Design decisions (confirmed with user):
 *   - Docker bridge (172.16/12) and typical 10.x container ranges are in a
 *     different /24 from the host LAN (192.168.x.y), so they naturally fall out.
 *   - Hostname backends ("whoami:8080") fail isIPv4 and are ignored.
 *   - When instanceIP is not IPv4 (endpoint configured by hostname rather than IP),
 *     the function returns [] — a silent no-op rather than a false positive.
 */
export function externalBackends(service: Service, instanceIP: string): string[] {
  if (!isIPv4(instanceIP)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sv of service.servers) {
    const host = hostFromServer(sv);
    if (!host) continue;
    if (!isIPv4(host)) continue;
    if (host === instanceIP) continue;
    if (!sameSubnet24(host, instanceIP)) continue;
    if (!seen.has(host)) {
      seen.add(host);
      result.push(host);
    }
  }
  return result;
}

const stripProvider = (n: string) => n.replace(/@.*/, "");

/**
 * Find the service a router points to, searching all protocol service arrays.
 * Mirrors the lookup in Tables.tsx RouterDetail:
 *   strips the @provider suffix from both sides and matches by instance.
 */
export function findService(snapshot: Snapshot, router: Router): Service | undefined {
  return [
    ...snapshot.httpServices,
    ...snapshot.tcpServices,
    ...snapshot.udpServices,
  ].find(
    (s) =>
      stripProvider(s.name) === stripProvider(router.service) &&
      s.instance === router.instance,
  );
}

/**
 * Returns the unique list of external backend IPs for a router by resolving
 * its service through the snapshot and calling externalBackends.
 */
export function routerExternalIPs(
  router: Router,
  snapshot: Snapshot,
  instanceIP: string,
): string[] {
  const svc = findService(snapshot, router);
  if (!svc) return [];
  return externalBackends(svc, instanceIP);
}

/**
 * Returns all external routes for a given instance (by name and IP).
 * Collects every HTTP router belonging to the instance whose service has
 * external backends (same /24 as instanceIP but ≠ it), in router order.
 * Returns [] when instanceIP is not IPv4 or the instance has no external routes.
 *
 * Centralises the partition logic that used to be inlined in buildTopo /
 * buildTopoV so the gateway path gets identical treatment to downstream nodes.
 */
export function externalRoutesFor(
  snapshot: Snapshot,
  instanceName: string,
  instanceIP: string,
): ExternalRoute[] {
  if (!isIPv4(instanceIP)) return [];
  const result: ExternalRoute[] = [];
  for (const router of snapshot.httpRouters || []) {
    if (router.instance !== instanceName) continue;
    const ips = routerExternalIPs(router, snapshot, instanceIP);
    if (ips.length > 0) result.push({ router, ips });
  }
  return result;
}
