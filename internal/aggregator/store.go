// Package aggregator merges per-instance scrape results into a single snapshot
// and detects changes so the SSE hub only broadcasts on real updates.
package aggregator

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"net/url"
	"sort"
	"sync"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/traefik"
)

// Store holds the latest aggregated snapshot plus per-instance last-good data,
// so an unreachable node keeps showing its previous state (flagged stale).
type Store struct {
	mu       sync.RWMutex
	domain   string
	order    []string                          // instance order from config
	meta     map[string]config.Instance        // name -> config
	lastGood map[string]traefik.InstanceResult // name -> last successful scrape
	health   map[string]instanceHealth         // name -> live health
	snapshot *model.Snapshot
	hash     [32]byte
}

type instanceHealth struct {
	status     string // ok | degraded | unreachable
	version    string
	lastScrape int64
	scrapeMs   *int64
	err        string
}

// New builds a Store seeded from config (so the first snapshot has instance
// metadata even before the first scrape completes).
func New(cfg *config.Config) *Store {
	s := &Store{
		domain:   cfg.Server.Domain,
		meta:     map[string]config.Instance{},
		lastGood: map[string]traefik.InstanceResult{},
		health:   map[string]instanceHealth{},
	}
	for _, in := range cfg.Instances {
		s.order = append(s.order, in.Name)
		s.meta[in.Name] = in
		s.health[in.Name] = instanceHealth{status: "unreachable"}
	}
	s.snapshot = s.build(time.Now().UnixMilli())
	s.hash = hashSnapshot(s.snapshot)
	return s
}

// Apply records a fresh batch of scrape results and rebuilds the snapshot.
// It returns true when the snapshot changed (ignoring volatile timestamps).
func (s *Store) Apply(results []traefik.InstanceResult, now int64, durations map[string]time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, r := range results {
		h := instanceHealth{lastScrape: now, version: r.Version}
		if d, ok := durations[r.Name]; ok {
			ms := d.Milliseconds()
			h.scrapeMs = &ms
		}
		if r.Err != nil {
			h.status = "unreachable"
			h.err = r.Err.Error()
			if prev, ok := s.health[r.Name]; ok {
				h.version = prev.version
			}
			h.scrapeMs = nil
		} else {
			s.lastGood[r.Name] = r
			if r.Degraded {
				h.status = "degraded"
			} else {
				h.status = "ok"
			}
		}
		s.health[r.Name] = h
	}

	snap := s.build(now)
	newHash := hashSnapshot(snap)
	changed := newHash != s.hash
	s.snapshot = snap
	s.hash = newHash
	return changed
}

// Snapshot returns the current aggregated snapshot (safe to serialize).
func (s *Store) Snapshot() *model.Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshot
}

// build merges last-good per-instance data + live health into one snapshot.
// Caller must hold the lock.
func (s *Store) build(now int64) *model.Snapshot {
	snap := &model.Snapshot{
		GeneratedAt:    now,
		Domain:         s.domain,
		EntryPoints:    []string{},
		HTTPRouters:    []model.Router{},
		HTTPServices:   []model.Service{},
		Middlewares:    []model.Middleware{},
		TCPRouters:     []model.Router{},
		TCPServices:    []model.Service{},
		TCPMiddlewares: []model.Middleware{},
		UDPRouters:     []model.Router{},
		UDPServices:    []model.Service{},
		Certificates:   []model.Certificate{},
		Instances:      []model.Instance{},
	}
	epSet := map[string]bool{}

	for _, name := range s.order {
		if r, ok := s.lastGood[name]; ok {
			snap.HTTPRouters = append(snap.HTTPRouters, r.HTTPRouters...)
			snap.HTTPServices = append(snap.HTTPServices, r.HTTPServices...)
			snap.Middlewares = append(snap.Middlewares, r.Middlewares...)
			snap.TCPRouters = append(snap.TCPRouters, r.TCPRouters...)
			snap.TCPServices = append(snap.TCPServices, r.TCPServices...)
			snap.TCPMiddlewares = append(snap.TCPMiddlewares, r.TCPMiddlewares...)
			snap.UDPRouters = append(snap.UDPRouters, r.UDPRouters...)
			snap.UDPServices = append(snap.UDPServices, r.UDPServices...)
			snap.Certificates = append(snap.Certificates, r.Certificates...)
			for _, ep := range r.EntryPoints {
				epSet[ep] = true
			}
		}
		snap.Instances = append(snap.Instances, s.instance(name))
	}

	for ep := range epSet {
		snap.EntryPoints = append(snap.EntryPoints, ep)
	}
	sort.Strings(snap.EntryPoints)
	annotateCertStatus(snap.Certificates, now)
	return snap
}

// instance composes an Instance from config metadata + live health + counts.
func (s *Store) instance(name string) model.Instance {
	meta := s.meta[name]
	h := s.health[name]
	role := meta.Role
	if role == "" && name == "gateway" {
		role = "gateway" // fallback: an instance literally named "gateway"
	}
	in := model.Instance{
		Name:         name,
		Role:         role,
		URL:          meta.URL,
		IP:           hostOnly(meta.URL),
		DashboardURL: meta.DashboardURL,
		Status:       h.status,
		Version:      h.version,
		LastScrape:   h.lastScrape,
		ScrapeMs:     h.scrapeMs,
		Error:        h.err,
	}
	if r, ok := s.lastGood[name]; ok {
		in.Counts = model.InstanceCounts{
			Routers:     len(r.HTTPRouters),
			Services:    len(r.HTTPServices),
			Middlewares: usedMiddlewareCount(r.Middlewares),
			Warnings:    routerWarnings(r.HTTPRouters),
		}
	}
	return in
}

func usedMiddlewareCount(mws []model.Middleware) int {
	n := 0
	for _, m := range mws {
		if m.UsedBy > 0 {
			n++
		}
	}
	return n
}

func routerWarnings(rs []model.Router) int {
	n := 0
	for _, r := range rs {
		if r.Status != "enabled" {
			n++
		}
	}
	return n
}

// annotateCertStatus sets each cert's status to valid/expiring/expired.
func annotateCertStatus(certs []model.Certificate, now int64) {
	const dayMs = int64(24 * 60 * 60 * 1000)
	for i := range certs {
		if certs[i].NotAfter == 0 {
			continue // unknown; leave as reported
		}
		days := (certs[i].NotAfter - now) / dayMs
		switch {
		case days < 0:
			certs[i].Status = "expired"
		case days <= 21:
			certs[i].Status = "expiring"
		default:
			certs[i].Status = "valid"
		}
	}
}

// hostOnly extracts the host (IP or name) from a URL for display.
func hostOnly(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	return u.Hostname()
}

// hashSnapshot hashes everything except volatile timestamps so we don't
// broadcast on every poll.
func hashSnapshot(s *model.Snapshot) [32]byte {
	clone := *s
	clone.GeneratedAt = 0
	clone.Instances = make([]model.Instance, len(s.Instances))
	for i, in := range s.Instances {
		in.LastScrape = 0
		in.ScrapeMs = nil
		clone.Instances[i] = in
	}
	b, _ := json.Marshal(clone)
	h := sha256.Sum256(b)
	var n [8]byte
	binary.LittleEndian.PutUint64(n[:], uint64(len(b)))
	return sha256.Sum256(append(h[:], n[:]...))
}
