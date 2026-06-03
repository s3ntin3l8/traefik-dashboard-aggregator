# Changelog

## [v1.1.0] — 2026-06-03

### Features

- **Mobile-responsive layout** — below 860 px CSS the app switches to a phone-first layout without touching the desktop view:
  - Off-canvas sidebar triggered by a hamburger in a floating bottom bar; closes on scrim tap, nav selection, or Escape.
  - Floating bottom bar (menu · search · filter pill) with frosted-glass backdrop and safe-area-inset spacing; ≥16 px input font prevents iOS focus-zoom.
  - Instance filter as a multi-select bottom sheet; count badge on the filter button; "Show N nodes" confirm action. Desktop topbar chips also upgraded to multi-select.
  - Card-style rows replace dense tables on all data views (Routers, Services, Middlewares, TCP/UDP, Certificates); detail drawers open full-screen at ≤480 px.
  - Topology switches to a vertical layout on mobile (gateway left, instances stacked, packets flow top→down); desktop horizontal layout unchanged.
  - `100dvh` app container (with `100vh` fallback) and `viewport-fit=cover` fix mobile browser-chrome clipping and activate safe-area env vars.
- **PWA / installable app** — Vite PWA plugin adds a Workbox service worker that pre-caches the shell; the app is installable from the browser.

### Fixes

- Workbox service worker no longer bypasses Authentik forward-auth on the first load (SW scope restricted so auth-gated paths are never served from cache before the proxy can challenge them).

### Maintenance

- Go bumped to 1.25.11, addressing two stdlib CVEs reported by govulncheck:
  - `GO-2026-5039` — `net/textproto` unescaped inputs in errors
  - `GO-2026-5037` — `crypto/x509` inefficient hostname parsing

---

## [v1.0.2] — 2026-06-03

### Features

- Global omnibox search modal on the Overview page: typing opens a grouped results panel (HTTP Routers, Services, Middlewares, TCP/UDP, Certificates); clicking a result navigates to the target tab with the search term pre-applied and the detail drawer opened.
- Clear button (×) in the search field.

### Fixes

- Search modal correctly overlays page content (stacking context fix).
- Modal scoped to Overview only; all other tabs use inline row filtering.
- Clicking outside the modal dismisses it.
- Search term preserved when navigating from the modal so the target tab opens pre-filtered.
- Router cert resolver errors surfaced in the Overview attention panel.
- Cert resolver detection improved: cross-references actual certificates instead of relying on resolver name matching.
- TLS cert coverage detection uses host matching rather than resolver name.

---

## [v1.0.1] — 2026-06-02

### Features

- Search bar and instance filter chips work on the Overview page: filters the "Routes needing attention" panel (searches name, rule, service, and instance) and the instance health cards. When more than 10 results match, a "+N more" footer links to the full HTTP Routers view.

### Maintenance

- Release image publishing moved to tag-triggered workflow only; pushes to `main` build-validate without pushing to GHCR.

---

## [v1.0.0] — initial release
