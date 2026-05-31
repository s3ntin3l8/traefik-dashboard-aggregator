// Package httpapi exposes the aggregated snapshot (JSON + SSE), the logs proxy,
// health, and the embedded SPA.
package httpapi

import (
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/aggregator"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/loki"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/sse"
)

// Server bundles the dependencies the handlers need.
type Server struct {
	store            *aggregator.Store
	hub              *sse.Hub
	loki             *loki.Client
	spa              fs.FS
	log              *slog.Logger
	sseSlot          *limiter
	allowedInstances map[string]struct{}
	signOutPath      string
}

// New builds the HTTP server handler set.
func New(cfg *config.Config, store *aggregator.Store, hub *sse.Hub, lk *loki.Client, spa fs.FS, log *slog.Logger) *Server {
	allowed := make(map[string]struct{}, len(cfg.Instances))
	for _, in := range cfg.Instances {
		allowed[in.Name] = struct{}{}
	}
	signOut := ""
	if cfg.Server.SignOutPath != nil {
		signOut = *cfg.Server.SignOutPath
	}
	return &Server{
		store:            store,
		hub:              hub,
		loki:             lk,
		spa:              spa,
		log:              log,
		sseSlot:          newLimiter(maxSSEClients),
		allowedInstances: allowed,
		signOutPath:      signOut,
	}
}

// contentSecurityPolicy allows the app's own origin plus the Google Fonts CDNs
// it loads, and the inline styles React emits via style attributes. Scripts are
// same-origin only (Vite's inline modulepreload polyfill is disabled in the
// build), and framing is forbidden.
const contentSecurityPolicy = "default-src 'self'; " +
	"img-src 'self' data:; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"

// Handler returns the root mux wrapped in the middleware chain.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/snapshot", s.handleSnapshot)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("GET /api/logs/query", s.handleLogsQuery)
	mux.HandleFunc("GET /api/logs/tail", s.handleLogsTail)
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.Handle("GET /", s.spaHandler())
	return recoverMiddleware(s.log, securityHeaders(logMiddleware(s.log, mux)))
}

// securityHeaders adds defense-in-depth response headers to every response.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}

// recoverMiddleware turns a handler panic into a logged 500 instead of letting
// it tear down the connection silently.
func recoverMiddleware(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Error("panic in handler", "path", r.URL.Path, "err", v)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// spaHandler serves embedded assets, falling back to index.html for client
// routes (so deep links work).
func (s *Server) spaHandler() http.Handler {
	fileServer := http.FileServer(http.FS(s.spa))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(s.spa, p); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func logMiddleware(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Debug("request", "method", r.Method, "path", r.URL.Path, "dur", time.Since(start))
		}
	})
}
