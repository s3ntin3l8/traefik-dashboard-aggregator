# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (Go)

```sh
# Build
go build ./...

# Test (all packages, race detector)
go test -race ./...

# Test a single package
go test -race ./internal/aggregator/...

# Format check (CI enforces this)
gofmt -l $(git ls-files '*.go')

# Vet
go vet ./...

# Run the server
go run ./cmd/server -config ./config.yaml -debug
```

> The Go binary embeds `web/dist` via `//go:embed`. If `web/dist` doesn't exist, backend tests fail. Stub it first:
> ```sh
> mkdir -p web/dist && printf '<!doctype html><title>traefik-viewer</title>' > web/dist/index.html
> ```

### Frontend (Vite + React + TypeScript)

```sh
cd web
npm ci           # install
npm run build    # typecheck + production build → web/dist/
npm run dev      # HMR dev server on :5173, proxies /api → localhost:8080
```

### Docker

```sh
# Production (pulls GHCR image)
docker compose up -d

# Dev (live reload: Go backend + Vite HMR)
docker compose -f compose-dev.yaml up --build
```

### Git hooks

```sh
bash scripts/setup-hooks.sh    # run once after cloning
```

Hooks live in `.githooks/`. Pre-commit: blocks `.env`/`config.yaml` commits, real IPs in staged content, gofmt + go vet. Pre-push: full build + test + frontend build.

## Architecture

### Data flow

```
config.yaml
    │
    ▼
aggregator.Store (in-memory snapshot, last-good per instance)
    │
    ├── aggregator.Poller (goroutine, fires every pollInterval)
    │       └── traefik.Client.Scrape() — concurrent per endpoint
    │               └── GET /api/{http,tcp,udp}/{routers,services,middlewares}
    │                   GET /api/certificates (v3.7+ only, optional 404)
    │                   GET /api/version, /api/entrypoints
    │
    └── Store.Apply() → hash check → SSE hub.Broadcast() (only on change)
                                            │
                                            ▼
                                   EventSource /api/events
                                            │
                                            ▼
                                    useSnapshot() hook → React re-render
```

### Go packages (`internal/`)

| Package | Responsibility |
|---|---|
| `config` | Load + env-expand `config.yaml`; `${VAR}` references resolved at load time |
| `model` | Shared types: `Snapshot`, `Router`, `Service`, `Middleware`, `Certificate`, `Instance` |
| `traefik` | HTTP client per instance, `Scrape()` fans out concurrently, maps raw API → model types |
| `aggregator` | `Store` merges per-instance results; keeps last-good data so unreachable nodes show stale state; `Poller` drives the poll loop |
| `sse` | `Hub` manages SSE client registry; `redirect.go` contains the no-cross-host redirect transport |
| `httpapi` | Route mux, middleware chain (security headers, recover, logging), `limiter` caps SSE connections, `validate` checks Loki query params |
| `httpx` | Shared HTTP client utilities |
| `loki` | Loki client — query and tail; server-side LogQL builder (client can only filter by instance name from an allowlist, never raw LogQL) |

### Frontend (`web/src/`)

Single-page app; navigation is tab state in `App.tsx` (no router library). Key files:

- `lib/sse.ts` — `useSnapshot()` hook: initial fetch from `/api/snapshot`, then subscribes to SSE `/api/events`; `fetchLogs()` Loki proxy wrapper
- `lib/types.ts` — TypeScript types mirroring the Go `model` package
- `views/` — one file per tab; `Tables.tsx` covers HTTP routers/services/middlewares + detail `Drawer`; `ProtocolView.tsx` reuses the same table for TCP/UDP
- `components/ui.tsx` — shared icon set and low-level UI primitives

### Key invariants

- **Snapshot hashing**: `Store.hashSnapshot()` zeroes volatile fields (`generatedAt`, `lastScrape`, `scrapeMs`) before hashing so the SSE hub only broadcasts when routing/service data actually changes.
- **Stale data**: unreachable nodes stay in the snapshot with their last-good data and `status: "unreachable"` — the UI shows a stale banner rather than dropping the rows.
- **No auth**: the app has no built-in authentication. All endpoints (including `/api/snapshot` which exposes LAN IPs and cert metadata) must be protected by an upstream reverse proxy/SSO. The blessed path is forward-auth delegation (authentik) — see `docs/authentik.md`. `GET /api/me` reflects the proxy-injected `X-authentik-*` identity headers back to the SPA for a display-only "signed in as …" + logout link; the app makes **no** access decisions from them (the proxy is the sole enforcement point, contingent on `:8080` not being directly reachable and the edge stripping client-supplied identity headers). Non-browser/API consumers authenticate through authentik's own non-interactive token auth (Bearer JWT or `goauthentik.io/token` Basic), not a separate app-side credential — see `docs/authentik.md` §4.
- **Loki scoping**: the server builds the LogQL stream selector from config; the client can only pass an `?instance=` value validated against the configured instance list. Time windows (≤7 days) and result counts (≤5000) are clamped server-side.
- **Credential safety**: the Traefik and Loki HTTP clients reject cross-host redirects to prevent credential replay.

### CI

- **`ci.yml`**: gofmt → go vet → go build → go test -race → govulncheck → frontend typecheck + build → Docker image build (no push)
- **`release.yml`**: publishes multi-arch image to GHCR on `v*` tags only (`:X.Y.Z`, `:X.Y`, `:latest`); pushes to `main` are build-validated by `ci.yml` but not published
