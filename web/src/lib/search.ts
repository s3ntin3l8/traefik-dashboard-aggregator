// Pure global-search logic, lifted out of components/SearchModal.tsx. Builds the
// grouped, 5-capped result set; the component only attaches the click handler
// (onNavigate) using each item's `tab` + optional `sel`.
import type { Snapshot } from "./types";
import type { Sel } from "./sel";

export interface SearchResultItem {
  id: string;
  name: string;
  sub: string;
  instance: string;
  status: string;
  tab: string;
  sel?: Sel;
}

export interface SearchGroup {
  label: string;
  items: SearchResultItem[];
  extra: number;
}

const CAP = 5;

function group(label: string, matches: SearchResultItem[]): SearchGroup {
  return { label, items: matches.slice(0, CAP), extra: Math.max(0, matches.length - CAP) };
}

// The query is matched case-insensitively. Returns [] for an empty query rather
// than matching everything (the modal is only shown for non-empty queries).
export function searchSnapshot(snapshot: Snapshot, query: string): SearchGroup[] {
  const q = query.trim().toLowerCase();
  const groups: SearchGroup[] = [];
  if (!q) return groups;

  const httpRouters = (snapshot.httpRouters || [])
    .filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.rule || "").toLowerCase().includes(q) ||
      r.service.toLowerCase().includes(q) ||
      r.instance.toLowerCase().includes(q))
    .map<SearchResultItem>((r) => ({
      id: r.id,
      name: r.shortName || r.name,
      sub: r.host || r.rule || r.service,
      instance: r.instance,
      status: r.status,
      tab: "http_routers",
      sel: { kind: "router", data: r },
    }));
  if (httpRouters.length) groups.push(group("HTTP Routers", httpRouters));

  const httpServices = (snapshot.httpServices || [])
    .filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q) ||
      s.instance.toLowerCase().includes(q))
    .map<SearchResultItem>((s) => ({
      id: s.id,
      name: s.shortName || s.name,
      sub: s.type,
      instance: s.instance,
      status: s.status,
      tab: "http_services",
      sel: { kind: "service", data: s },
    }));
  if (httpServices.length) groups.push(group("HTTP Services", httpServices));

  const middlewares = (snapshot.middlewares || [])
    .filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.type.toLowerCase().includes(q) ||
      m.instance.toLowerCase().includes(q))
    .map<SearchResultItem>((m) => ({
      id: m.id,
      name: m.name,
      sub: m.type,
      instance: m.instance,
      status: m.error?.length ? "error" : "enabled",
      tab: "middlewares",
      sel: { kind: "middleware", data: m },
    }));
  if (middlewares.length) groups.push(group("Middlewares", middlewares));

  const tcpRouters = (snapshot.tcpRouters || [])
    .filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.rule || "").toLowerCase().includes(q) ||
      r.instance.toLowerCase().includes(q))
    .map<SearchResultItem>((r) => ({
      id: r.id,
      name: r.shortName || r.name,
      sub: r.rule || r.service,
      instance: r.instance,
      status: r.status,
      tab: "tcp_routers",
    }));
  if (tcpRouters.length) groups.push(group("TCP Routers", tcpRouters));

  const udpRouters = (snapshot.udpRouters || [])
    .filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.instance.toLowerCase().includes(q))
    .map<SearchResultItem>((r) => ({
      id: r.id,
      name: r.shortName || r.name,
      sub: r.service,
      instance: r.instance,
      status: r.status,
      tab: "udp_routers",
    }));
  if (udpRouters.length) groups.push(group("UDP Routers", udpRouters));

  const certs = (snapshot.certificates || [])
    .filter((c) =>
      c.domain.toLowerCase().includes(q) ||
      (c.sans || []).join(" ").toLowerCase().includes(q) ||
      c.instance.toLowerCase().includes(q))
    .map<SearchResultItem>((c) => ({
      id: c.id,
      name: c.domain,
      sub: c.wildcard ? "wildcard" : (c.issuerCN || c.issuer),
      instance: c.instance,
      status: c.status,
      tab: "certificates",
    }));
  if (certs.length) groups.push(group("Certificates", certs));

  return groups;
}
