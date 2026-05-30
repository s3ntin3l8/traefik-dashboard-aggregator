# traefik-viewer

A lightweight, self-hosted **aggregate dashboard** for multiple Traefik instances.

If you run a gateway Traefik that fans out to several downstream Traefik nodes
(e.g. one per Proxmox host, each discovering apps via Docker labels), each node
has its own dashboard but there's no single combined view. `traefik-viewer`
scrapes every node's REST API, merges the results, and serves one live UI of all
routers, services, middlewares, certificates and per-node health.

- **Backend:** Go — polls each instance concurrently, merges into an in-memory
  snapshot, pushes updates over SSE. Single static binary, distroless image.
- **Frontend:** Vite + React + TypeScript SPA, embedded into the binary via
  `go:embed`. Two visual styles (Terminal / Console), light & dark, on a
  Settings page.
- **Logs (optional):** the Traefik API doesn't expose logs, so the Logs view
  queries a **Loki** backend instead.

## Views

Overview (health hero + live topology) · HTTP / TCP / UDP routers, services &
middlewares (sortable, searchable, with a detail drawer) · TLS Certificates
(expiry tracking) · Logs (via Loki) · Instances (per-node health) · Settings.

## Quick start

1. **Configure.** Copy the example and edit it:
   ```sh
   cp config.example.yaml config.yaml
   ```
   If an instance's `/api` requires auth, put credentials in a gitignored `.env`
   (referenced from the config as `${VAR}`):
   ```sh
   NODE01_API_USER=admin
   NODE01_API_PASS=…
   ```

2. **Set your deployment specifics.** `compose.yaml` pulls the published image
   from GHCR and ships generic labels. Put your real host rule (and any other
   environment-specific overrides) in a gitignored `compose.override.yaml`,
   which Docker merges automatically:
   ```sh
   cp compose.override.example.yaml compose.override.yaml
   # edit compose.override.yaml → set your Host(`…`) rule (and optionally pin a tag)
   ```

3. **Run with Docker:**
   ```sh
   docker compose up -d            # pulls ghcr.io/s3ntin3l8/traefik-dashboard-aggregator:latest
   # or build locally: uncomment `build: .` in compose.yaml, then `docker compose up --build -d`
   ```
   The app has no built-in auth — put it behind your gateway/SSO. The published
   image is multi-arch (amd64/arm64), distroless, with the SPA embedded.

4. **Develop** (live reload + HMR):
   ```sh
   docker compose -f compose-dev.yaml up --build
   # UI on http://localhost:5173 (proxies /api to the Go backend on :8080)
   ```

## Configuration

```yaml
server:
  listenAddr: ":8080"
  pollInterval: 15s        # how often to scrape each instance
  requestTimeout: 10s
  domain: example.com      # optional, shown in the UI

loki:
  url: ""                  # e.g. http://loki:3100 — empty disables the Logs tab
  labelMapping: { job: traefik }

instances:
  - name: node-01
    url: https://10.0.0.11              # scrape the node directly by LAN IP
    host: traefik.node-01.example.com    # Host header so the node's /api router matches
    dashboardURL: https://traefik.node-01.example.com/dashboard/   # optional deep link
    insecureSkipVerify: true             # if the node serves a default/self-signed cert on its IP
    # basicAuth:                          # only if /api requires auth
    #   username: ${NODE01_API_USER}
    #   password: ${NODE01_API_PASS}
```

### Reaching the downstream APIs

Each downstream Traefik must have its API enabled (`--api=true`) and an `/api`
router the aggregator can reach. Two patterns:

- **Direct by LAN IP (recommended):** the aggregator dials the node's IP and
  sends the `host` header so the existing `Host(...)` `/api` router matches.
  Protect that router with basic auth and supply the credentials here.
- **Via the gateway (fallback):** point `url` at the gateway and `host` at the
  node's API subdomain. Note that a gateway-side `ipAllowList` sees the
  *gateway's* source IP, so it needs `ipStrategy.depth` + trusted
  `X-Forwarded-For` to be meaningful — treat basic auth as the primary control.

Requires Traefik **v3.7+** for the `/api/certificates` endpoint (Certificates
view). Other views work on any v3.

## Endpoints

- `GET /` — the embedded SPA
- `GET /api/snapshot` — full merged snapshot (JSON)
- `GET /api/events` — SSE stream (snapshot on connect + on every change)
- `GET /api/logs/query` · `GET /api/logs/tail` — Loki proxy (when configured)
- `GET /healthz` — liveness

## CI/CD

**GitHub Actions** (`.github/workflows/`):
- `ci.yml` — on every push/PR to `main`: Go `gofmt`/`vet`/`build`/`test -race`,
  frontend typecheck + build, and a Docker image build (no push).
- `release.yml` — publishes a multi-arch image to
  `ghcr.io/<owner>/<repo>` — `:edge` on each push to `main`, and
  `:vX.Y.Z` / `:X.Y` on `v*` tags.

**Git hooks** (versioned in `.githooks/`, shared across clones). Enable once
after cloning:
```sh
bash scripts/setup-hooks.sh    # sets core.hooksPath=.githooks
```
- **pre-commit** (fast, staged-only): blocks secret-ish files (`.env`,
  `config.yaml`, keys), blocks real IPs/hostnames in staged content, runs
  `gofmt` + `go vet` on staged Go.
- **pre-push** (heavier): `go build` + `go test`, and the frontend build.

Bypass a hook in a pinch with `--no-verify`. Hooks degrade gracefully if the Go
toolchain or `npm` isn't present locally — CI enforces the full set regardless.

## Development without Docker

```sh
# backend
go run ./cmd/server -config ./config.yaml -debug
# frontend (separate shell)
cd web && npm install && npm run dev
```

## License

MIT
