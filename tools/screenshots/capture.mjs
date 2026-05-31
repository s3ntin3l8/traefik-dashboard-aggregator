// Capture the README screenshots from the real SPA running against the mock
// backend. Headless Chromium at 1440×960 @2x → crisp 2880×1920 PNGs that match
// the existing set's dimensions (so the README layout doesn't reflow).
//
//   node capture.mjs
//
// Requires: the SPA built into web/dist (`npm run build` in web/) and Playwright
// chromium available (`npx playwright install chromium`). If Chromium can't be
// resolved, set CHROME_PATH to a chrome binary, e.g. the cached one:
//   CHROME_PATH=~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome node capture.mjs

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../docs/screenshots");
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;

const VIEWPORT = { width: 1440, height: 960 };
const SCALE = 2;

// Each shot: a fresh context (isolated localStorage) → optional theme tweaks →
// optional nav click → wait → screenshot (full viewport, or a single element).
const SHOTS = [
  { file: "overview.png", waitFor: ".hcard" },
  { file: "certificates.png", nav: "Certificates", waitFor: ".crow" },
  { file: "logs.png", nav: "Logs", waitFor: ".log-line" },
  { file: "tables.png", nav: "Services", waitFor: ".dtable tbody tr" },
  { file: "overview-terminal.png", tweaks: { dir: "a", theme: "light" }, waitFor: ".hcard" },
  { file: "topology.png", waitFor: ".topo", element: "topology" },
];

function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(__dirname, "mock-server.mjs")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (b) => {
      if (b.toString().includes("mock backend on")) resolve(child);
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error("mock server did not start in time")), 8000);
  });
}

async function launch() {
  const opts = { args: ["--no-sandbox", "--force-color-profile=srgb"] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  return chromium.launch(opts);
}

async function run() {
  const mock = await startMock();
  const browser = await launch();
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: SCALE,
        colorScheme: "dark",
      });
      if (shot.tweaks) {
        await context.addInitScript((tw) => {
          localStorage.setItem("tv-tweaks", JSON.stringify(tw));
        }, shot.tweaks);
      }
      const page = await context.newPage();
      // not networkidle: the SSE streams (/api/events, /api/logs/tail) stay open
      await page.goto(BASE, { waitUntil: "domcontentloaded" });

      if (shot.nav) {
        await page.locator(".nav-item", { hasText: shot.nav }).first().click();
      }
      if (shot.waitFor) {
        await page.waitForSelector(shot.waitFor, { timeout: 10000 });
      }
      // let the one-shot fade-in finish and topology packets populate
      await page.waitForTimeout(1000);

      const dest = path.join(OUT, shot.file);
      if (shot.element === "topology") {
        const panel = page.locator(".panel", {
          has: page.locator(".panel-title", { hasText: "Topology · live request flow" }),
        });
        await panel.screenshot({ path: dest });
      } else {
        await page.screenshot({ path: dest }); // viewport, not full page
      }
      console.log("✓", shot.file);
      await context.close();
    }
  } finally {
    await browser.close();
    mock.kill();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
