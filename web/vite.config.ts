/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const target = process.env.VITE_API_TARGET || "http://localhost:8080";

// In dev, proxy the API + SSE to the Go backend. In prod the Go server serves
// the built assets and the API from the same origin, so no proxy is needed.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Inject an external registerSW.js script — compatible with script-src 'self' CSP.
      injectRegister: "script",
      manifest: {
        name: "Traefik Dashboard Aggregator",
        short_name: "Traefik Agg",
        description: "Aggregate dashboard for multiple Traefik instances.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0c0e16",
        theme_color: "#0c0e16",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Activate the new SW immediately when installed (skip waiting for old
        // tabs to close), then claim all existing clients so every open page
        // switches to the new SW without a full close/reopen cycle.
        skipWaiting: true,
        clientsClaim: true,
        // Precache JS bundles, CSS, and static assets — but NOT index.html.
        // Excluding index.html ensures navigation requests always reach the
        // network so the Authentik forward-auth proxy can redirect expired
        // sessions to login instead of the browser serving a cached page.
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2,woff}"],
        // vite-plugin-pwa always injects a NavigationRoute; deny everything so
        // it never fires. All navigations fall through to the network and
        // Authentik can handle session expiry correctly.
        navigateFallbackDenylist: [/.*/],
        runtimeCaching: [
          {
            // API calls must always reach the backend — never serve from cache.
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            // Cache Google Fonts for one year (font URLs are content-addressed).
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
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
