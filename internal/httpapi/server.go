// Package httpapi exposes the aggregated snapshot (JSON + SSE), the logs proxy,
// health, and the embedded SPA.
package httpapi

import (
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/s3ntin3l8/traefik-viewer/internal/aggregator"
	"github.com/s3ntin3l8/traefik-viewer/internal/loki"
	"github.com/s3ntin3l8/traefik-viewer/internal/sse"
)

// Server bundles the dependencies the handlers need.
type Server struct {
	store *aggregator.Store
	hub   *sse.Hub
	loki  *loki.Client
	spa   fs.FS
	log   *slog.Logger
}

// New builds the HTTP server handler set.
func New(store *aggregator.Store, hub *sse.Hub, lk *loki.Client, spa fs.FS, log *slog.Logger) *Server {
	return &Server{store: store, hub: hub, loki: lk, spa: spa, log: log}
}

// Handler returns the root mux.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/snapshot", s.handleSnapshot)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("GET /api/logs/query", s.handleLogsQuery)
	mux.HandleFunc("GET /api/logs/tail", s.handleLogsTail)
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.Handle("GET /", s.spaHandler())
	return logMiddleware(s.log, mux)
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
