# Production-readiness review — traefik-viewer (pre-v1.0.0)

Scope: full Go backend, React SPA, Docker/Compose, CI/CD. Focus: security, bugs,
stability, maintenance. Build state at review: `go vet` clean, `go test -race ./...`
passes (aggregator/config/traefik). `httpapi`, `loki`, `sse` have **no tests**.

Severity legend: **BLOCKER** (fix before tagging v1.0.0) · **HIGH** · **MEDIUM** · **LOW**.

---

## Security model (read first)

The app ships with **no authentication of its own** and is documented to "sit behind
your gateway" (`compose.yaml:17`). That is a legitimate model, but nothing in the
binary enforces it, and two endpoints make the assumption load-bearing:

- `/api/snapshot` discloses every node's LAN IP, hostnames, cert serials/SANs,
  middleware configs, and dashboard URLs to anyone who can reach the port.
- `/api/logs/query` + `/api/logs/tail` proxy **client-controlled LogQL** to the
  operator's central Loki using the server's stored Loki credentials.

So "behind the gateway" is the *only* security control. Make it explicit and
enforced-by-default (see SEC-1, SEC-2).

---

## BLOCKERS

### B-1 — Loki proxy lets any caller run arbitrary LogQL with the server's credentials
`internal/httpapi/handlers.go:104-106`, `internal/loki/client.go:96-101`

The `query` parameter is passed straight through; `QueryRange` only substitutes the
default selector when it is **empty**. A caller can send
`?query={job="anything"}` and read *any* stream in Loki — not just Traefik logs —
authenticated as traefik-viewer's Loki user. Because the app has no auth, the blast
radius equals "anyone who can open the dashboard."

Fix: enforce the configured selector server-side. Either (a) reject any client query
whose stream selector isn't the configured `labelMapping`/default, or (b) ignore the
client's selector entirely and only accept a pipeline/filter expression that you
append to the server-built selector. Add a handler test for the rejection path.

### B-2 — No LICENSE file
`git ls-files | grep -i licen` → none.

The repo is public and the image is published to GHCR, but there is no
LICENSE/COPYING. Without one, the default is "all rights reserved" — nobody may
legally redistribute or use the v1.0.0 image. Add a LICENSE (e.g. MIT/Apache-2.0)
before tagging.

### B-3 — Go binary ships with patchable stdlib CVEs; one is relevant to the proxies
`go.mod:3` (`go 1.23.4`), CI `go-version: "1.23"`

`govulncheck ./...` reports the standard library (go1.23.4) is affected by many CVEs,
including **GO-2025-3420 — net/http sends sensitive headers after a cross-domain
redirect**. That is directly relevant here: both `loki.Client.QueryRange` and
`traefik.Client.getJSON` use `http.Client.Do` with `SetBasicAuth` and follow redirects
by default, so a downstream Loki/Traefik node that 30x-redirects to another host could
receive the basic-auth header. **Note:** the full govulncheck set (as of the review
date) requires **go1.25.10** to clear all *called* stdlib CVEs — 1.23.6 only fixes a
subset. Fixes: (1) bump the toolchain to the current patched release (`go 1.25.10` in
`go.mod`; CI via `go-version-file: go.mod`; `golang:1.25-alpine` in Docker);
(2) defense-in-depth, set `http.Client.CheckRedirect` on both clients to refuse
cross-host redirects; (3) add `govulncheck` to CI so this is caught automatically.

---

## HIGH

### SEC-1 — No upper bound on Loki `limit` / time window (DoS amplification)
`internal/httpapi/handlers.go:89-100`, `internal/loki/client.go:101-103`

`limit` is `strconv.Atoi` with no max; `start`/`end` are unbounded. A caller can ask
for `limit=10000000` over a multi-year window, multiplying load onto Loki and pulling
up to the 32 MiB read cap per request. Clamp `limit` (e.g. ≤ 5000) and the maximum
window server-side.

### SEC-2 — `/api/snapshot` is unauthenticated topology disclosure
`internal/httpapi/handlers.go:18-20`

By design, but worth elevating: there is no opt-in auth, no `X-Frame-Options`/CSP, and
the data is internal-network-sensitive. Recommend (a) a prominent README security
section stating the deployment requirement, and (b) optionally a minimal built-in
auth toggle (bearer token / basic auth) so the app is safe even if the gateway
middleware is ever misconfigured. At minimum add security headers (SEC-5).

---

## MEDIUM

### BUG-1 — `handleLogsTail` advances `since` before checking the error → silent log loss
`internal/httpapi/handlers.go:142-148`

```go
since = now
if err != nil { continue }
```

`since` is moved forward unconditionally. On any Loki error, the window
`since…now` is skipped permanently and those lines never stream once Loki recovers.
Only advance `since` after a successful query (ideally to the max timestamp actually
received, to avoid duplicate/missed lines at the boundary).

### STAB-1 — SSE endpoints have no connection cap; tail multiplies Loki load
`internal/httpapi/handlers.go:117-159`, `internal/sse/hub.go`

Every `/api/events` and `/api/logs/tail` connection holds a goroutine + ticker.
`/api/logs/tail` fires a fresh Loki query every 3 s **per connected client**, so N
open browser tabs = N× Loki query rate with no ceiling. Add a max-clients guard and
consider a single shared tail poller fanned out to subscribers.

### TEST-1 — Zero tests on the network-facing packages
`internal/httpapi`, `internal/loki`, `internal/sse`

The Loki proxy (query restriction, clamping), SSE lifecycle, and SPA fallback are the
highest-risk, least-tested code. Add handler-level tests (httptest) covering: query
rejection (B-1), limit clamp (SEC-1), the `since` fix (BUG-1), and `requireLoki`
503 path. This is the coverage that protects the v1.0.0 security fixes from regressing.

### MAINT-1 — Dockerfile uses `npm install`, not `npm ci`
`Dockerfile:7`

CI uses `npm ci` but the release image uses `npm install`, so the shipped artifact can
drift from `package-lock.json`. Use `npm ci` in the image build for reproducibility.

---

## LOW / maintenance

- **SEC-3 — `dashboardURL` rendered as raw `href` without scheme guard.**
  `web/src/views/Tables.tsx:232,254`, `ProtocolView.tsx:208`, `Instances.tsx:27`.
  Operator-configured (not attacker-controlled), but cheap to harden: validate the
  value is `http(s):`. All request/log-derived links are already safe (hardcoded
  `http(s)://` prefix; everything else renders as escaped JSX — no XSS found anywhere).
- **SEC-4 — Config `$`-expansion footgun.** `internal/config/config.go:72` runs
  `os.Expand` over the whole YAML, so any literal `$word` (e.g. inside a Host rule,
  regex, or a password typed directly into the file) is expanded to an env value or
  empty string. Document that `$` must come from `${VAR}` refs / be escaped.
- **SEC-5 — No security headers.** Add a middleware setting `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), and a basic
  CSP. Defense-in-depth, and the Logs view renders semi-trusted content.
- **STAB-2 — No panic-recovery middleware.** `net/http` recovers per-request, but a
  recovery middleware would log panics via slog and return a clean 500.
- **STAB-3 — Overlapping polls if a scrape exceeds `pollInterval`.**
  `internal/aggregator/poller.go:44-56`. Default (10 s timeout < 15 s interval) is
  safe; if misconfigured, ticks can launch concurrent `pollOnce`. Skip a tick when one
  is in flight.
- **STAB-4 — Compose has `restart: unless-stopped` but no healthcheck.** `/healthz`
  exists; add a compose healthcheck so a wedged process is detected/restarted.
- **PERF-1 (frontend) — `Topology.tsx:138-159`** re-renders at ~60 fps continuously
  via a `requestAnimationFrame` loop while Overview is mounted (cleaned up correctly,
  but never idles). **`Certificates.tsx:14`** puts `Date.now()` in `useMemo` deps so
  the memo never caches. **`Logs.tsx:67-71`** dedups via O(n) scan per incoming line
  (capped at 2000 — bounded, just inefficient). All non-blocking.
- **MAINT-2 — `release.yml` pushes an image on every commit to main (`:edge`).**
  Intended? Worth confirming; otherwise it publishes on each merge.
- **MAINT-4 — Module path ≠ repo/image name.** `go.mod` is
  `github.com/s3ntin3l8/traefik-viewer`, but the GitHub repo (and therefore the GHCR
  image, correctly referenced in `compose.yaml`) is `traefik-dashboard-aggregator`.
  Not broken — `release.yml` uses `${{ github.repository }}` so the image name is
  right — but the mismatch is confusing. Pick one name (renaming the module is the
  honest fix; it touches every import path).
- **DEPS-1 — npm: `esbuild`/`vite` moderate advisory (GHSA-67mh-4wv8-2f99).**
  `npm audit` flags esbuild ≤0.24.2 (via vite ≤6.4.1). The vuln is the esbuild **dev
  server** only; the production artifact is a static `vite build` embedded in the Go
  binary, so the shipped app is **not** exposed. Fixing requires a vite-8 major bump
  (breaking). Low priority — note it, don't let it block the tag.
- **MAINT-3 — `summarize` in `ProtocolView.tsx:11-16`** renders `[object Object]` for
  nested config (the `Tables.tsx` variant `JSON.stringify`s it). Display-only.

---

## What's solid

- Clean shutdown with signal context + 5 s graceful drain (`cmd/server/main.go`).
- `ReadHeaderTimeout` set (Slowloris-resistant); per-request HTTP client timeouts.
- Snapshot **does not** leak credentials — basic-auth lives only in the config `meta`
  map, never in `model.Instance`.
- SSE hub is correct: buffered, coalescing, no goroutine leak on unsubscribe; `-race`
  clean.
- Distroless `nonroot` runtime image, `-trimpath`, stripped binary, CGO off.
- Stale-node handling (last-good cache + health flag) is a nice resilience touch.
- Change-detection hash avoids broadcasting on every poll.
- No XSS anywhere in the SPA (verified: no `dangerouslySetInnerHTML`/`innerHTML`/`eval`).

---

## Suggested order for v1.0.0

1. B-2 (add LICENSE) + B-3 (bump Go ≥1.23.6, add `govulncheck` to CI) — minutes each,
   pure release hygiene.
2. B-1 + SEC-1 (Loki query restriction + clamps) + TEST-1 for them — the one real
   security hole.
3. BUG-1 (`since` advance) — small, correctness.
4. SEC-5 security headers, MAINT-1 `npm ci`, STAB-4 healthcheck — cheap hardening.
5. Remaining LOW items as follow-ups; none block the tag.

## Scan coverage (for honesty)

- `go vet ./...`: clean. `go test -race ./...`: pass (aggregator/config/traefik only).
- `govulncheck ./...`: run — 26 stdlib findings (all from the 1.23.4 toolchain; see B-3),
  no findings in first-party-called third-party code.
- `npm audit` (web): 2 moderate, dev-server-only (see DEPS-1).
