/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.VITE_API_TARGET || "http://localhost:8080";

// In dev, proxy the API + SSE to the Go backend. In prod the Go server serves
// the built assets and the API from the same origin, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true, ws: false },
      "/healthz": { target },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Skip Vite's inline modulepreload polyfill so the server can ship a strict
    // `script-src 'self'` CSP with no inline <script>. Targets modern browsers.
    modulePreload: { polyfill: false },
  },
  // Pure-logic unit tests run in a node environment (no DOM); see src/**/*.test.ts.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
