// Mock backend for screenshot capture: serves the built SPA (web/dist) plus the
// frontend-facing /api surface filled with sanitized demo data. No production Go
// code is involved — this only exists to render the app deterministically.
//
//   node mock-server.mjs            # serves on http://localhost:8099
//   PORT=9000 node mock-server.mjs
//
// Mirrors internal/httpapi handlers closely enough that the real SPA can't tell:
// /api/snapshot, /api/events (SSE), /api/config, /api/me, /api/logs/{query,tail}.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, buildLogs } from "./demo-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../web/dist");
const PORT = Number(process.env.PORT) || 8099;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function sendJSON(res, obj) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function sseHead(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(DIST, rel);
  // SPA fallback: unknown non-asset routes render index.html
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404).end("not found — run `npm run build` in web/ first");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }

  if (p === "/api/snapshot") {
    sendJSON(res, buildSnapshot(Date.now()));
    return;
  }

  if (p === "/api/config") {
    sendJSON(res, { lokiEnabled: true });
    return;
  }

  if (p === "/api/me") {
    sendJSON(res, { user: "", email: "", name: "", groups: "", signOutPath: "" });
    return;
  }

  if (p === "/api/logs/query") {
    const now = Date.now();
    const start = Number(url.searchParams.get("start")) || now - 30 * 60 * 1000;
    const end = Number(url.searchParams.get("end")) || now;
    const inst = url.searchParams.get("instance") || "";
    sendJSON(res, { entries: buildLogs(start, end, inst) });
    return;
  }

  if (p === "/api/events") {
    // Emit the snapshot once, then hold the connection open with heartbeats so
    // the SPA shows the "● live" badge instead of "offline".
    sseHead(res);
    res.write("event: snapshot\ndata: " + JSON.stringify(buildSnapshot(Date.now())) + "\n\n");
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => clearInterval(ping));
    return;
  }

  if (p === "/api/logs/tail") {
    // Open SSE, no live lines needed for a still screenshot — just heartbeat.
    sseHead(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => clearInterval(ping));
    return;
  }

  serveStatic(req, res, p);
});

server.listen(PORT, () => {
  console.log(`mock backend on http://localhost:${PORT} (serving ${DIST})`);
});
