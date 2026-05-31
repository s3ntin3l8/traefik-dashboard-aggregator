package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/loki"
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.store.Snapshot())
}

// handleConfig reports feature availability to the SPA (e.g. is Loki enabled).
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"lokiEnabled": s.loki != nil})
}

// handleEvents streams the snapshot over SSE: once on connect, then on every
// change, with periodic heartbeats so proxies don't drop the idle connection.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if !s.sseSlot.acquire() {
		http.Error(w, "too many streaming clients", http.StatusServiceUnavailable)
		return
	}
	defer s.sseSlot.release()
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")

	notify, unsub := s.hub.Subscribe()
	defer unsub()

	send := func() {
		b, err := json.Marshal(s.store.Snapshot())
		if err != nil {
			return
		}
		_, _ = w.Write([]byte("event: snapshot\ndata: "))
		_, _ = w.Write(b)
		_, _ = w.Write([]byte("\n\n"))
		flusher.Flush()
	}

	send() // initial state

	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-notify:
			send()
		case <-ping.C:
			_, _ = w.Write([]byte(": ping\n\n"))
			flusher.Flush()
		}
	}
}

func (s *Server) requireLoki(w http.ResponseWriter) bool {
	if s.loki == nil {
		http.Error(w, `{"error":"loki not configured"}`, http.StatusServiceUnavailable)
		return false
	}
	return true
}

// maxLogWindow bounds how much history a single logs query may span.
const maxLogWindow = 7 * 24 * time.Hour

// logInstance reads and validates the optional ?instance= filter. It returns
// (value, true) when usable, or ("", false) when a non-empty value is invalid
// (the caller has already written a 400). An empty value is valid (all streams).
func logInstance(w http.ResponseWriter, r *http.Request) (string, bool) {
	inst := r.URL.Query().Get("instance")
	if inst != "" && !validInstanceName(inst) {
		http.Error(w, `{"error":"invalid instance"}`, http.StatusBadRequest)
		return "", false
	}
	return inst, true
}

// handleLogsQuery proxies a Loki query_range over a time window. The stream
// selector is built server-side; the client may only narrow it to a validated
// instance, never supply raw LogQL.
func (s *Server) handleLogsQuery(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoki(w) {
		return
	}
	inst, ok := logInstance(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	now := time.Now()
	start := now.Add(-30 * time.Minute)
	if v := q.Get("start"); v != "" {
		if ms, err := strconv.ParseInt(v, 10, 64); err == nil {
			start = time.UnixMilli(ms)
		}
	}
	end := now
	if v := q.Get("end"); v != "" {
		if ms, err := strconv.ParseInt(v, 10, 64); err == nil {
			end = time.UnixMilli(ms)
		}
	}
	start, end = clampWindow(start, end, maxLogWindow)
	limit, _ := strconv.Atoi(q.Get("limit"))

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	entries, err := s.loki.QueryRange(ctx, loki.QueryParams{
		Instance: inst, Start: start, End: end, Limit: limit,
	})
	if err != nil {
		s.log.Warn("loki query failed", "err", err)
		http.Error(w, `{"error":"loki query failed"}`, http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{"entries": entries})
}

// handleLogsTail streams new log lines via SSE by polling Loki for the most
// recent window every few seconds (simple, robust; avoids Loki websockets).
func (s *Server) handleLogsTail(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoki(w) {
		return
	}
	inst, ok := logInstance(w, r)
	if !ok {
		return
	}
	if !s.sseSlot.acquire() {
		http.Error(w, "too many streaming clients", http.StatusServiceUnavailable)
		return
	}
	defer s.sseSlot.release()
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")

	since := time.Now().Add(-1 * time.Minute)
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			now := time.Now()
			qctx, cancel := context.WithTimeout(ctx, 8*time.Second)
			entries, err := s.loki.QueryRange(qctx, loki.QueryParams{Instance: inst, Start: since, End: now, Limit: 200})
			cancel()
			// BUG-1: only advance the cursor on success, else a transient
			// Loki error would skip this window's lines once Loki recovers.
			since = advanceSince(since, now, err)
			if err != nil {
				continue
			}
			for _, e := range entries {
				b, _ := json.Marshal(e)
				_, _ = w.Write([]byte("event: log\ndata: "))
				_, _ = w.Write(b)
				_, _ = w.Write([]byte("\n\n"))
			}
			flusher.Flush()
		}
	}
}
