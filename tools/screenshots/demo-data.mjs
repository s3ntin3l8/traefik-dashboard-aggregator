// Deterministic, sanitized demo data for the README screenshots.
//
// Shapes mirror web/src/lib/types.ts (== internal/model/model.go). All addresses
// use RFC-5737 documentation ranges (203.0.113.0/24, 198.51.100.0/24) and the
// example.com domain so nothing real ever leaks into a committed PNG.
//
// Structure is seeded (stable across runs); only the time-relative fields
// (generatedAt, lastScrape, cert notBefore/notAfter, log ts) are stamped from
// the `now` passed in at serve time, so the data never visibly ages.

// --- tiny seeded RNG (mulberry32) so layout is stable between runs ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const SEC = 1000;
const DAY = 86400 * SEC;

// --- nodes ------------------------------------------------------------------
// gateway fans out to three downstream nodes (one per "Proxmox host"). Router
// counts here drive both the per-node cards and the topology constellation.
const NODES = [
  { name: "gateway", role: "gateway", ip: "203.0.113.10", version: "3.7.4", routers: 6, scrapeAgo: 21, scrapeMs: 41 },
  { name: "node-a", role: "node", ip: "203.0.113.11", version: "3.7.4", routers: 18, scrapeAgo: 24, scrapeMs: 58 },
  { name: "node-b", role: "node", ip: "203.0.113.12", version: "3.7.3", routers: 20, scrapeAgo: 22, scrapeMs: 50 },
  { name: "node-c", role: "node", ip: "203.0.113.13", version: "3.7.4", routers: 16, scrapeAgo: 27, scrapeMs: 73 },
];

const APP_NAMES = [
  "grafana", "prometheus", "whoami", "uptime-kuma", "vaultwarden", "gitea",
  "jellyfin", "nextcloud", "paperless", "immich", "homeassistant", "adguard",
  "portainer", "registry", "minio", "audiobookshelf", "linkwarden", "mealie",
  "frigate", "n8n", "actual", "wikijs", "dashy", "syncthing", "stirling-pdf",
  "code-server", "navidrome", "calibre", "freshrss", "changedetection",
];

// Middlewares live per-instance (the aggregator concatenates each node's set).
// Keeping the union at 9 matches a realistic small fleet. Routers only reference
// middlewares present on their own node so the drawer request-chain resolves.
const MIDDLEWARES = [
  { node: "gateway", name: "redirect-https", type: "redirectScheme", config: { scheme: "https", permanent: true } },
  { node: "gateway", name: "secure-headers", type: "headers", config: { stsSeconds: 31536000, frameDeny: true, contentTypeNosniff: true } },
  { node: "gateway", name: "compress", type: "compress", config: {} },
  { node: "node-a", name: "rate-limit", type: "rateLimit", config: { average: 100, burst: 50 } },
  { node: "node-a", name: "forward-auth", type: "forwardAuth", config: { address: "http://authentik:9000/outpost.goauthentik.io/auth/traefik" } },
  { node: "node-b", name: "gzip", type: "compress", config: {} },
  { node: "node-b", name: "ip-allowlist", type: "ipAllowList", config: { sourceRange: ["203.0.113.0/24", "198.51.100.0/24"] } },
  { node: "node-c", name: "strip-prefix", type: "stripPrefix", config: { prefixes: ["/api"] } },
  { node: "node-c", name: "basic-auth", type: "basicAuth", config: { realm: "Restricted", users: ["1 user"] } },
];

const ENTRYPOINTS = ["web", "websecure", "metrics"];

function hex(r, n) {
  let s = "";
  for (let i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(r() * 16)];
  return s;
}

// Build the full snapshot. Deterministic structure; time fields stamped from now.
export function buildSnapshot(now = Date.now()) {
  const r = rng(0x7c6cff);

  const httpRouters = [];
  const httpServices = [];
  const middlewares = [];
  const certificates = [];

  // assign a stable, unique app per router across the whole fleet
  let appCursor = 0;
  const mwByNode = {};
  for (const m of MIDDLEWARES) (mwByNode[m.node] ||= []).push(`${m.name}@docker`);

  for (const node of NODES) {
    for (let i = 0; i < node.routers; i++) {
      const app = APP_NAMES[appCursor % APP_NAMES.length];
      const suffix = appCursor >= APP_NAMES.length ? `-${Math.floor(appCursor / APP_NAMES.length) + 1}` : "";
      appCursor++;
      const base = `${app}${suffix}`;
      const fqdn = `${base}.example.com`;
      const rname = `${base}@docker`;
      const sname = `${base}@docker`;

      const mws = [];
      const avail = mwByNode[node.name] || [];
      if (avail.length) {
        mws.push(avail[0]);
        if (r() < 0.4 && avail[1]) mws.push(avail[1]);
      }

      httpRouters.push({
        id: `${rname}#${node.name}`,
        name: rname,
        shortName: base,
        rule: `Host(\`${fqdn}\`)`,
        host: fqdn,
        service: sname,
        serviceStatus: "ok",
        middlewares: mws,
        entryPoints: ["websecure"],
        tls: true,
        certResolver: "letsencrypt",
        provider: "docker",
        instance: node.name,
        status: "enabled",
        priority: 0,
        url: `https://${fqdn}`,
      });

      // matching service with 1-3 backends, all healthy for now
      const total = 1 + (r() < 0.3 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
      const servers = Array.from({ length: total }, (_, k) => ({
        url: `http://172.20.${NODES.indexOf(node)}.${10 + (i % 200)}:${8000 + k}`,
        status: "UP",
      }));
      httpServices.push({
        id: `${sname}#${node.name}`,
        name: sname,
        shortName: base,
        provider: "docker",
        type: "loadbalancer",
        instance: node.name,
        servers,
        serversUp: total,
        serversTotal: total,
        status: "ok",
        usedBy: [rname],
      });
    }
  }

  // Inject a fixed number of problems so the Overview's "routes needing
  // attention" and "node degraded" panels are populated and stable across runs.
  // Spread the router warnings across node-b/node-c (leave gateway/node-a clean).
  const problemRouters = httpRouters.filter((rt) => rt.instance === "node-b" || rt.instance === "node-c");
  for (let i = 0; i < 5 && i < problemRouters.length; i++) {
    const rt = problemRouters[Math.floor((i * problemRouters.length) / 5)];
    rt.status = i % 3 === 2 ? "error" : "warning";
    rt.serviceStatus = "degraded";
  }
  // Degrade a few services (a down backend) on nodes that have multi-server svcs.
  const multi = httpServices.filter((s) => s.serversTotal > 1);
  for (let i = 0; i < 5 && i < multi.length; i++) {
    const s = multi[Math.floor((i * multi.length) / 5)];
    s.servers[s.servers.length - 1].status = "DOWN";
    s.serversUp = s.serversTotal - 1;
    s.status = "degraded";
  }

  // Guarantee every defined middleware is referenced by ≥1 router on its node,
  // so the "Middlewares" stat card (total) and the nav badge (in-use count) agree.
  for (const m of MIDDLEWARES) {
    const full = `${m.name}@docker`;
    const used = httpRouters.some((rt) => rt.instance === m.node && rt.middlewares.includes(full));
    if (!used) {
      const first = httpRouters.find((rt) => rt.instance === m.node);
      if (first) first.middlewares.push(full);
    }
  }

  // distribute the fleet's middlewares, counting real usage from the routers
  for (const m of MIDDLEWARES) {
    const full = `${m.name}@docker`;
    const users = httpRouters.filter((rt) => rt.instance === m.node && rt.middlewares.includes(full));
    middlewares.push({
      id: `${full}#${m.node}`,
      name: m.name,
      fullName: full,
      type: m.type,
      provider: "docker",
      instance: m.node,
      config: m.config,
      usedBy: users.length,
      usedByRouters: users.map((u) => u.name),
      error: [],
    });
  }

  // certificates: one per a subset of hosts + a wildcard per node, mixed expiry
  const issuers = [
    { issuer: "Let's Encrypt", cn: "R3", key: "RSA 2048" },
    { issuer: "Let's Encrypt", cn: "E5", key: "EC 256" },
  ];
  const certHosts = httpRouters.filter((_, i) => i % 4 === 0).slice(0, 12);
  let expiringBudget = 5;
  for (const rt of certHosts) {
    const iss = pick(r, issuers);
    // most valid (30-89d), a handful expiring (2-20d)
    let daysLeft = 30 + Math.floor(r() * 60);
    if (expiringBudget > 0 && r() < 0.6) {
      daysLeft = 2 + Math.floor(r() * 18);
      expiringBudget--;
    }
    certificates.push({
      id: `cert-${rt.shortName}`,
      domain: rt.host,
      wildcard: false,
      sans: [rt.host],
      resolver: "letsencrypt",
      issuer: iss.issuer,
      issuerCN: iss.cn,
      serial: hex(r, 24).toUpperCase(),
      keyType: iss.key,
      notBefore: now - (60 + Math.floor(r() * 20)) * DAY,
      notAfter: now + daysLeft * DAY,
      instance: rt.instance,
      status: "valid",
    });
  }
  // one wildcard per node
  for (const node of NODES.filter((n) => n.role === "node")) {
    const iss = pick(r, issuers);
    certificates.push({
      id: `cert-wild-${node.name}`,
      domain: "*.example.com",
      wildcard: true,
      sans: ["*.example.com", "example.com"],
      resolver: "letsencrypt",
      issuer: iss.issuer,
      issuerCN: iss.cn,
      serial: hex(r, 24).toUpperCase(),
      keyType: iss.key,
      notBefore: now - 40 * DAY,
      notAfter: now + (45 + Math.floor(r() * 30)) * DAY,
      instance: node.name,
      status: "valid",
    });
  }

  // a little TCP/UDP so those tabs aren't empty
  const tcpRouters = [
    mkProtoRouter("postgres", "node-a", "Postgres", ["postgres"]),
    mkProtoRouter("redis", "node-b", "Redis", ["redis"]),
    mkProtoRouter("mqtt", "node-c", "MQTT", ["mqtt"]),
  ];
  const tcpServices = [
    mkProtoService("postgres", "node-a", "203.0.113.21:5432"),
    mkProtoService("redis", "node-b", "203.0.113.22:6379"),
    mkProtoService("mqtt", "node-c", "203.0.113.23:1883"),
  ];
  const udpRouters = [
    mkProtoRouter("coredns", "node-a", "CoreDNS", ["dns"]),
    mkProtoRouter("wireguard", "gateway", "WireGuard", ["wg"]),
  ];
  const udpServices = [
    mkProtoService("coredns", "node-a", "203.0.113.21:53"),
    mkProtoService("wireguard", "gateway", "203.0.113.10:51820"),
  ];

  // per-node counts derived from the actual arrays so cards/topology agree
  const instances = NODES.map((node) => {
    const rs = httpRouters.filter((x) => x.instance === node.name);
    const ss = httpServices.filter((x) => x.instance === node.name);
    const ms = middlewares.filter((x) => x.instance === node.name);
    return {
      name: node.name,
      role: node.role,
      url: `https://${node.ip}`,
      ip: node.ip,
      dashboardURL: `https://traefik.${node.name}.example.com/dashboard/`,
      status: "ok",
      version: node.version,
      lastScrape: now - node.scrapeAgo * SEC,
      scrapeMs: node.scrapeMs,
      counts: {
        routers: rs.length,
        services: ss.length,
        middlewares: ms.filter((m) => m.usedBy > 0).length,
        warnings: rs.filter((x) => x.status !== "enabled").length,
      },
    };
  });

  return {
    generatedAt: now,
    domain: "example.com",
    instances,
    entryPoints: ENTRYPOINTS,
    httpRouters,
    httpServices,
    middlewares,
    tcpRouters,
    tcpServices,
    tcpMiddlewares: [],
    udpRouters,
    udpServices,
    certificates,
  };
}

function mkProtoRouter(name, instance, label, eps) {
  return {
    id: `${name}@docker#${instance}`,
    name: `${name}@docker`,
    shortName: name,
    rule: `HostSNI(\`${name}.example.com\`)`,
    host: `${name}.example.com`,
    service: `${name}@docker`,
    serviceStatus: "ok",
    middlewares: [],
    entryPoints: eps,
    tls: true,
    provider: "docker",
    instance,
    status: "enabled",
    priority: 0,
  };
}

function mkProtoService(name, instance, address) {
  return {
    id: `${name}@docker#${instance}`,
    name: `${name}@docker`,
    shortName: name,
    provider: "docker",
    type: "loadbalancer",
    instance,
    servers: [{ address, status: "UP" }],
    serversUp: 1,
    serversTotal: 1,
    status: "ok",
    usedBy: [`${name}@docker`],
  };
}

// --- logs -------------------------------------------------------------------
// Generate access + system log lines spread across the requested window so the
// histogram and stream always fill, regardless of which range the UI asks for.
const METHODS = ["GET", "GET", "GET", "GET", "POST", "PUT", "DELETE"];
const PATHS = [
  "/", "/api/health", "/api/v1/query", "/login", "/dashboard", "/static/app.js",
  "/favicon.ico", "/metrics", "/ws", "/api/users/me", "/assets/index.css",
  "/.well-known/acme-challenge/x", "/api/items?page=2", "/webhook",
];
const SYSTEM_MSGS = [
  ["info", "Configuration loaded from flags."],
  ["info", "Starting provider *docker.Provider"],
  ["info", "Server configuration reloaded on :443"],
  ["warning", "Router defined multiple times with different configurations"],
  ["error", "Unable to obtain ACME certificate for domains"],
  ["warning", "Health check failed: connection refused"],
];

export function buildLogs(startMs, endMs, instanceFilter = "") {
  const r = rng(0x19c37d ^ (startMs & 0xffff));
  const nodes = NODES.map((n) => n.name).filter((n) => !instanceFilter || n === instanceFilter);
  const span = Math.max(1, endMs - startMs);
  const count = 320;
  const out = [];
  for (let i = 0; i < count; i++) {
    const ts = startMs + Math.floor(r() * span);
    const instance = pick(r, nodes);
    const isSystem = r() < 0.08;
    if (isSystem) {
      const [level, msg] = pick(r, SYSTEM_MSGS);
      out.push({
        id: `sys-${i}`,
        ts,
        kind: "system",
        level,
        instance,
        app: "traefik",
        msg,
        fields: { level, providerName: "docker" },
      });
      continue;
    }
    const status = pick(r, [200, 200, 200, 200, 204, 301, 302, 304, 404, 401, 500, 502]);
    const level = status >= 500 ? "error" : status >= 400 ? "warning" : "info";
    const app = pick(r, APP_NAMES);
    out.push({
      id: `acc-${i}`,
      ts,
      kind: "access",
      level,
      instance,
      app,
      router: `${app}@docker`,
      service: `${app}@docker`,
      method: pick(r, METHODS),
      path: pick(r, PATHS),
      host: `${app}.example.com`,
      status,
      durationMs: 1 + Math.floor(r() * 240),
      size: Math.floor(r() * 80000),
      clientIP: `198.51.100.${10 + Math.floor(r() * 240)}`,
      proto: "HTTP/2.0",
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}
