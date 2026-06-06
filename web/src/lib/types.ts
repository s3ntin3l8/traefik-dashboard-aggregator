// Types mirror the backend snapshot contract (internal/model/model.go), which
// in turn matches the design prototype's window.TV.buildSnapshot() shape.

export type RouterStatus = "enabled" | "warning" | "error" | "disabled";
export type HealthStatus = "ok" | "degraded" | "down";
export type InstanceStatus = "ok" | "degraded" | "unreachable";
export type CertStatus = "valid" | "expiring" | "expired" | string;

export interface Server {
  url?: string;
  address?: string;
  status: string; // UP | DOWN
}

export interface Router {
  id: string;
  name: string;
  shortName: string;
  rule?: string;
  host?: string;
  service: string;
  serviceStatus?: HealthStatus;
  middlewares: string[];
  entryPoints: string[];
  tls: boolean;
  certResolver?: string;
  provider: string;
  instance: string;
  status: RouterStatus;
  errors?: string[];
  priority?: number;
  url?: string;
  authentik?: AuthentikInfo;
}

// The authentik application guarding a forward-auth-protected router,
// resolved server-side by matching the router host against the provider's
// external_host / cookie_domain.
export interface AuthentikInfo {
  application?: string;
  slug?: string;
  provider?: string;
  outpost?: string;
  mode?: string; // forward_single | forward_domain
}

// Marker + aggregated apps/outposts for an authentik forward-auth middleware.
// Present (possibly empty) on every middleware whose address points at an
// authentik outpost.
export interface MiddlewareAuthentik {
  applications?: string[];
  outposts?: string[];
}

export interface Service {
  id: string;
  name: string;
  shortName: string;
  provider: string;
  type: string;
  instance: string;
  servers: Server[];
  serversUp: number;
  serversTotal: number;
  status: HealthStatus;
  usedBy: string[];
}

export interface Middleware {
  id: string;
  name: string;
  fullName: string;
  type: string;
  provider: string;
  instance: string;
  config: Record<string, unknown>;
  usedBy: number;
  usedByRouters: string[];
  error?: string[];
  authentik?: MiddlewareAuthentik;
}

export interface Certificate {
  id: string;
  domain: string;
  wildcard: boolean;
  sans: string[];
  resolver: string;
  issuer: string;
  issuerCN: string;
  serial: string;
  keyType: string;
  notBefore: number;
  notAfter: number;
  instance: string;
  status: CertStatus;
}

export interface InstanceCounts {
  routers: number;
  services: number;
  middlewares: number;
  warnings: number;
}

export interface Instance {
  name: string;
  role?: "gateway" | "node" | string;
  url: string;
  ip: string;
  dashboardURL: string;
  status: InstanceStatus;
  version: string;
  lastScrape: number;
  scrapeMs: number | null;
  error?: string;
  counts: InstanceCounts;
}

export interface Snapshot {
  generatedAt: number;
  domain: string;
  instances: Instance[];
  entryPoints: string[];
  httpRouters: Router[];
  httpServices: Service[];
  middlewares: Middleware[];
  tcpRouters: Router[];
  tcpServices: Service[];
  tcpMiddlewares: Middleware[];
  udpRouters: Router[];
  udpServices: Service[];
  certificates: Certificate[];
}

export interface LogEntry {
  id: string;
  ts: number;
  kind: "access" | "system";
  level: "info" | "warning" | "error";
  instance: string;
  app?: string;
  router?: string;
  service?: string;
  method?: string;
  path?: string;
  host?: string;
  status?: number;
  durationMs?: number;
  size?: number;
  clientIP?: string;
  proto?: string;
  msg?: string;
  fields?: Record<string, unknown>;
}

export function statusKind(s: string): "ok" | "warn" | "down" {
  if (s === "ok" || s === "enabled" || s === "UP") return "ok";
  if (s === "degraded" || s === "warning") return "warn";
  return "down";
}

export const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  degraded: "Degraded",
  unreachable: "Down",
  warning: "Warning",
  error: "Error",
  enabled: "Enabled",
  down: "Down",
};
