# Screenshot harness

Regenerates the README screenshots (`docs/screenshots/*.png`) by rendering the
**real SPA** against a mock backend filled with **sanitized demo data** — no real
Traefik instance, Loki, or personal infrastructure is involved, so nothing
private can leak into a committed image.

The original demo-data generator lived in an external design prototype that was
never committed and is gone; this harness is its replacement. Keep it working.

## How it works

```
demo-data.mjs    deterministic, sanitized Snapshot + log generator
                 (RFC-5737 IPs, example.com, node-a/b/c, app-NNN@docker).
                 Time-relative fields are stamped from `now` at serve time, so
                 the data never visibly ages between re-shoots.
mock-server.mjs  node:http server: serves web/dist + the frontend /api surface
                 (/api/snapshot, /api/events SSE, /api/config, /api/me,
                 /api/logs/{query,tail}).
capture.mjs      Playwright (headless Chromium @ 1440×960 ×2 → 2880×1920) drives
                 the SPA tab-by-tab and writes the PNGs.
```

The harness has its **own** `package.json` so Playwright never lands in the app's
(`web/`) dependency tree or the pre-push frontend build.

## Regenerate

```sh
# 1. build the SPA the mock server serves
cd ../../web && npm ci && npm run build

# 2. install the harness deps + browser, then capture
cd ../tools/screenshots
npm install
npx playwright install chromium     # cached after first run
npm run capture                     # → docs/screenshots/*.png
```

If Chromium can't be resolved, point at any Chrome binary:

```sh
CHROME_PATH=~/.cache/ms-playwright/chromium-XXXX/chrome-linux64/chrome npm run capture
```

## Preview the demo UI by hand

```sh
npm run serve     # mock backend on http://localhost:8099 (needs web/dist built)
```

## Shots produced

| File | View |
|---|---|
| `overview.png` | Overview (dark / Console) |
| `topology.png` | Topology card (element crop) |
| `certificates.png` | Certificates |
| `logs.png` | Logs (Loki) |
| `tables.png` | HTTP Services |
| `overview-terminal.png` | Overview (Terminal style + light theme) |

To change the data (more nodes, different problem counts, etc.) edit
`demo-data.mjs` — shapes mirror `web/src/lib/types.ts`.
