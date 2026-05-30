# traefik-viewer — Implementation Plan

## Context

A **gateway Traefik** (192.168.2.210) distributes via wildcard host rules to several **downstream
Traefik instances** — one per Proxmox node (mgmt 192.168.2.157, dockerhost 192.168.2.96, …), each
discovering apps from Docker labels. Each node has its own dashboard but there is **no aggregate
view**. `traefik-viewer` is a lightweight, always-on Docker app that scrapes every downstream
Traefik's REST API, merges it, and serves one combined, live-updating UI — built to a concrete
design the user produced in Claude Design (handoff bundle extracted to `/tmp/tvdesign/trafik-viewer/`).

### Verified live facts (probed with the user-provided admin credentials)
- Downstreams run **Traefik v3.7.1 "langres"**; reachable directly over the LAN by IP on :443.
  Routing is strictly by **Host header** (`traefik.{host}.in.s3ntin3l8.de`, e.g. mgmt→`traefik.mgmt…`,
  dockerhost→`traefik.dockerhost…`). Bare IP → 404 + Traefik default cert (so `insecureSkipVerify`).
- `/api/*` is **auth-protected** (basic auth `admin:<password>`, supplied via env). The whole
  endpoint set the UI needs returns **200** with creds: `/api/overview`, `/api/version`,
  `/api/entrypoints`, `/api/http/{routers,services,middlewares}`, `/api/tcp/{routers,services,middlewares}`,
  `/api/udp/{routers,services}`, and **`/api/certificates`** (the v3.7 dashboard certificates feature
  — full Let's Encrypt cert data: `sans[]`, `notAfter`, `notBefore`, `commonName`, `issuerOrg`,
  `issuerCN`, `keyType`, `keySize`, `signatureAlgorithm`, `serialNumber`, `status`).
- `/api/rawdata` only carries routers/services/middlewares — so use the **typed list endpoints**
  above (richer: computed `status`, `serverStatus`, `usedBy`) plus `/api/certificates`.

### Decisions
- **Stack:** Go backend + embedded **Vite + React + TypeScript** SPA → single static binary,
  distroless image. Frontend embedded via `go:embed`. Only Go runtime dep: `gopkg.in/yaml.v3`.
- **Reachability:** scrape each node **direct by LAN IP** with a per-instance `Host` header + basic
  auth + `insecureSkipVerify`. (Gateway-routed URL supported as a per-instance fallback.)
- **Config:** YAML with `${ENV}` expansion (secrets in env only).
- **App auth:** none (sits behind the gateway). **Refresh:** background poll + **SSE** live push.
- **Logs:** sourced from the user's central **Loki** (the Traefik API does not expose logs); backend
  proxies Loki `query_range` + tail. The design's Logs view is built against this.
- **Design:** implement the full Claude Design bundle (see below) — two visual directions, all views.
- **Version control:** `git init` + `.gitignore` + commits along the way.

---

## The design bundle (what to build)

Source prototype: `/tmp/tvdesign/trafik-viewer/project/` (React/JSX via Babel CDN — **reimplement
in Vite/React/TS, pixel-perfect**, don't copy the prototype's loader). Read order per its README:
`chats/chat1.md` (intent) → `traefik-viewer.html` → each `tv-*.jsx` + `tv-styles.css`. Screenshots
in `project/screenshots/` are visual reference.

**Theming (port `tv-styles.css`, ~28 KB of tokens):** two **directions** — A "Ops Terminal"
(Space Grotesk/JetBrains Mono, sharp 2px radius, hairline borders, neon) and B "Modern Console"
(Manrope, soft 12px radius, shadows) — each in **light + dark**, plus **accent** (5 swatches) and
**density** (compact/regular/comfy). All driven by `data-dir` / `data-theme` / `data-density` +
`--accent` on `<html>`. A **Tweaks panel** + sidebar segmented controls switch them live. Default:
dir=b, dark, accent `#7c6cff`. (Can be trimmed to a plain light/dark toggle later; building as
designed since the CSS already exists.)

**Navigation / views** (sidebar grouped with dividers):
- **Overview** — instance-health hero cards + a novel **animated topology** (gateway → nodes →
  router constellation with live request-flow packets, health-colored) + "routes needing attention".
- **HTTP** — Routers · Services · Middlewares (sortable tables, global search `/`, node + status
  filter chips, **detail drawer** showing the full chain entry→middlewares→service→backends + deep links).
- **TCP** — Routers · Services · Middlewares (same table/drawer pattern; HostSNI, TLS passthrough).
- **UDP** — Routers · Services.
- **TLS** — **Certificates**: summary tiles (total/valid/expiring≤21d/expired), table sorted
  soonest-expiry-first with color-coded expiry bars, domain/SANs/resolver/issuer/days-left/node,
  status chips, detail drawer.
- **Observe** — **Logs** (Loki): LogQL query bar, level chips w/ counts, All/Access/System toggle,
  **time-range picker** (15m/1h/6h/24h), stacked volume **histogram with click-to-zoom**, pausable
  **live tail**, detail drawer with structured access-log fields + Loki label selector ("via Loki").
  **Instances** — health panel: version, scrape latency, reachability errors, last-good-data banner.
- Topbar: global search, shared **node filter chips** (carry across all table/cert pages), live clock.

**Snapshot data contract** (what `/api/snapshot` + SSE must emit — matches the prototype's
`window.TV.buildSnapshot()` so components bind unchanged):
```
{ generatedAt, domain, instances[], entryPoints[],
  httpRouters[], httpServices[], middlewares[],
  tcpRouters[], tcpServices[], tcpMiddlewares[],
  udpRouters[], udpServices[], certificates[] }
```
Key row shapes (from `tv-data.js`): routers `{id,name,shortName,rule,host,service,serviceStatus,
middlewares[],entryPoints[],tls,provider,instance,status(enabled|warning|error),priority,url}`;
services `{id,name,provider,type,instance,servers[{url,status}],serversUp,serversTotal,
status(ok|degraded|down),usedBy[]}`; middlewares `{id,name,fullName,type,provider,instance,
config,usedBy,usedByRouters[]}`; certificates `{id,domain,wildcard,sans[],resolver,issuer,issuerCN,
serial,keyType,notBefore,notAfter,instance}`; instances `{name,url,ip,dashboardURL,status,version,
lastScrape,scrapeMs,error,counts{routers,services,middlewares,warnings}}`. `statusKind()` folds to
ok/warn/down for chips.

---

## Architecture

```
Browser ──SSE/HTTP──> traefik-viewer (Go) ──┬─ https://192.168.2.157/api/*  (Host: traefik.mgmt…, basicAuth)
   (embedded SPA)         │ poll ~15s        ├─ https://192.168.2.96/api/*   (Host: traefik.dockerhost…)
                          │ (concurrent)     └─ … per configured node
                          ▼
                    in-memory Snapshot ──► SSE broadcast on change
   Logs tab ──/api/logs──> Loki (query_range / tail)   [separate from the poll loop]
```

### Repository layout
```
traefik-viewer/
├── cmd/server/main.go            # wire config → store → poller → http server; graceful shutdown
├── internal/
│   ├── config/config.go          # YAML load, ${ENV} expansion, defaults, validation
│   ├── traefik/{types.go,client.go,scrape.go}   # typed API client (Host override, basicAuth, TLS), concurrent scrape
│   ├── aggregator/{store.go,poller.go}          # merged snapshot, ticker fan-out, canonical-hash change detection
│   ├── loki/client.go            # query_range + tail proxy for the Logs view
│   ├── sse/hub.go                # SSE client registry + broadcast (heartbeats, no-buffering headers)
│   └── httpapi/{server.go,handlers.go}          # /api/snapshot, /api/events, /api/logs/*, /healthz, SPA
├── web/                          # Vite + React + TS (ported design)
│   ├── embed.go                  # //go:embed all:dist
│   ├── src/{App.tsx, theme/, components/, views/{Overview,Tables,Certs,Logs,Topology,Instances}, lib/sse.ts, lib/types.ts}
│   ├── src/styles/tokens.css     # ported tv-styles.css (both directions × themes × density)
│   └── dist/                     # build output (git-ignored), embedded
├── config.example.yaml · Dockerfile · Dockerfile.dev · compose.yaml · compose-dev.yaml
├── .air.toml · .gitignore · go.mod · README.md
```

### Backend → Traefik endpoint mapping (per instance, base `<url>/api`, Host header + basicAuth)
`/version`→instance.version · `/overview`→counts/features/providers · `/entrypoints`→entryPoints ·
`/http/{routers,services,middlewares}` · `/tcp/{routers,services,middlewares}` · `/udp/{routers,services}`
· `/certificates`→certificates. ~11 GETs/instance/poll, concurrent, per-request timeout. On failure:
instance `status=unreachable`, keep last-good rows, surface `error` (drives the stale banner).

### SSE + change detection
`/api/events`: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`,
flush per write, periodic `: ping` heartbeats. Send current snapshot on connect + on change. Hash a
**canonical (sorted)** snapshot so Go map-iteration randomness doesn't cause false "changed" every poll.

### Logs (Loki)
Config `loki.url` (+ optional auth, per-instance label mapping). Backend endpoints:
`GET /api/logs/query` → Loki `/loki/api/v1/query_range`; `GET /api/logs/tail` (SSE) → Loki tail or
ranged polling. Map node/app/level/range/LogQL from the UI to label selectors. Frontend Logs view
binds to these instead of the prototype's mock generator.

### Docker + git
Multi-stage Dockerfile: `node:24-alpine` (vite build → `web/dist`) → `golang:1.23-alpine`
(`CGO_ENABLED=0 go build -ldflags="-s -w"`, dist embedded) → `gcr.io/distroless/static-debian12:nonroot`
(CA certs included), EXPOSE 8080. `compose.yaml` (prod): config volume + env file + gateway labels +
`restart: unless-stopped`. `compose-dev.yaml`: `backend` (air, watch `*.go`) + `frontend` (vite :5173,
proxy `/api` incl. SSE). `git init` + `.gitignore` (Go output, `web/node_modules`, `web/dist`,
`config.yaml`, `.env`).

### Config schema (`config.example.yaml`)
```yaml
server: { listenAddr: ":8080", pollInterval: 15s, requestTimeout: 10s }
loki:   { url: "", labelMapping: {} }        # Logs view; empty = logs disabled
instances:
  - name: mgmt
    url: https://192.168.2.157               # /api appended; direct LAN IP
    host: traefik.mgmt.in.s3ntin3l8.de        # Host header so the node's /api router matches
    dashboardURL: https://traefik.mgmt.in.s3ntin3l8.de/dashboard/
    insecureSkipVerify: true                  # node serves Traefik default cert on bare IP
    basicAuth: { username: ${MGMT_API_USER}, password: ${MGMT_API_PASS} }
  - name: dockerhost
    url: https://192.168.2.96
    host: traefik.dockerhost.in.s3ntin3l8.de
    dashboardURL: https://traefik.dockerhost.in.s3ntin3l8.de/dashboard/
    insecureSkipVerify: true
    basicAuth: { username: ${DOCKERHOST_API_USER}, password: ${DOCKERHOST_API_PASS} }
```
`os.Expand` over file bytes before YAML unmarshal. `host` overrides HTTP Host + TLS SNI while dialing `url`.

---

## Build sequence
1. **Repo + config** — `git init`, `.gitignore`, `go mod init`; `config` package (load + `${ENV}` +
   validation + defaults) with tests.
2. **Traefik client** — `types.go` (all entities incl. certs/entrypoints), `client.go` (Host/basicAuth/
   TLS), concurrent `scrape.go`; decode tests against fixtures captured from the live 3.7.1 nodes
   (`/api/http/routers`, `/api/certificates`, …).
3. **Aggregator** — `store.go` merge into the snapshot contract (instance-tag every row, derive
   statuses), `poller.go` ticker/fan-out + canonical-hash change detection; tests.
4. **HTTP + SSE** — `sse/hub.go`, handlers (`/api/snapshot`, `/api/events`, `/healthz`), `web/embed.go`,
   `main.go` glue + graceful shutdown. Verify against live nodes end-to-end.
5. **Frontend scaffold + theming** — Vite/React/TS; port `tv-styles.css` tokens (both directions ×
   themes × density), Tweaks panel, app shell (sidebar groups, topbar search + node chips, live clock),
   `lib/sse.ts` + `lib/types.ts` bound to the snapshot contract.
6. **Tables + drawer** — HTTP/TCP/UDP Routers·Services·Middlewares + the shared detail drawer
   (request/stream chain, backends, deep links), node/status filters, sorting, search.
7. **Overview + Topology + Instances** — health hero, animated gateway→nodes→routers topology,
   problems list, instances health panel + stale-data banner.
8. **Certificates** — view + tiles + expiry bars + drawer, bound to `/api/certificates` data.
9. **Logs (Loki)** — `loki/client.go` + `/api/logs/*`; Logs view (query bar, level/kind/node filters,
   time-range picker, histogram w/ click-to-zoom, live tail, drawer) bound to real Loki.
10. **Packaging + docs** — Dockerfile(s), compose files, `.air.toml`, README (credentials/env, config,
    run/build, Loki setup); commit milestones.

---

## Verification
- **Unit tests:** config parse + `${ENV}`; Traefik JSON decode against live-captured fixtures;
  aggregator merge + change-detection (no spurious SSE when unchanged); cert expiry/status thresholds.
- **Live end-to-end:** point `config.yaml` at mgmt + dockerhost (creds in env) → `/api/snapshot`
  returns merged routers/services/middlewares/certs/instances; UI renders all views; SSE pushes a
  change live without reload; stop a node → it flips to `unreachable` with the stale banner.
- **Logs:** with `loki.url` set, the Logs view queries real data; range picker + click-to-zoom + tail work.
- **Image:** `docker build .` → distroless image ~25–35 MB, container starts, `/healthz` → 200, behind gateway.
- **Design fidelity:** compare each view against `project/screenshots/` in both directions + light/dark.
