package aggregator

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/authentik"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/traefik"
)

// Notifier is called (with the fresh snapshot already in the store) whenever a
// poll produces a changed snapshot.
type Notifier interface {
	Broadcast()
}

// authentikTTL rate-limits authentik index refreshes (and retries after a
// failure): the data is near-static, no need to hit the API on every poll.
const authentikTTL = time.Minute

// Poller periodically scrapes every instance and updates the store. The
// client set and poll interval are mutex-guarded so Reconfigure can swap them
// at runtime (a UI-driven instance edit) while Run's poll loop keeps ticking.
type Poller struct {
	store  *Store
	notify Notifier
	log    *slog.Logger

	mu       sync.Mutex
	clients  []*traefik.Client
	interval time.Duration

	polling atomic.Bool
	reload  chan struct{} // buffered 1: wakes Run to reset the ticker + poll now

	ak        *authentik.Client // nil when enrichment is disabled
	akRefresh time.Time         // last refresh attempt (success or failure)
}

// NewPoller wires clients for each configured instance.
func NewPoller(cfg *config.Config, store *Store, notify Notifier, log *slog.Logger) *Poller {
	return &Poller{
		store:    store,
		clients:  buildClients(cfg.Instances, cfg.Server.RequestTimeout),
		interval: cfg.Server.PollInterval,
		notify:   notify,
		log:      log,
		reload:   make(chan struct{}, 1),
		ak:       authentik.New(cfg.Authentik, cfg.Server.RequestTimeout),
	}
}

func buildClients(instances []config.Instance, timeout time.Duration) []*traefik.Client {
	clients := make([]*traefik.Client, 0, len(instances))
	for _, in := range instances {
		clients = append(clients, traefik.NewClient(in, timeout))
	}
	return clients
}

// Reconfigure swaps the client set and poll interval used by future polls,
// then wakes Run to reset its ticker and poll immediately -- so a saved
// instance edit is reflected in the very next scrape instead of waiting out
// whatever remains of the old interval. Safe to call concurrently with Run.
func (p *Poller) Reconfigure(instances []config.Instance, interval, requestTimeout time.Duration) {
	p.mu.Lock()
	p.clients = buildClients(instances, requestTimeout)
	p.interval = interval
	p.mu.Unlock()

	select {
	case p.reload <- struct{}{}:
	default: // a reload is already pending; coalesce
	}
}

func (p *Poller) snapshotClients() []*traefik.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.clients
}

func (p *Poller) currentInterval() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.interval
}

// Run scrapes immediately, then on the configured interval until ctx is done.
// A Reconfigure call resets the ticker and triggers an immediate poll.
func (p *Poller) Run(ctx context.Context) {
	p.pollOnce(ctx)
	t := time.NewTicker(p.currentInterval())
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.pollOnce(ctx)
		case <-p.reload:
			t.Reset(p.currentInterval())
			p.pollOnce(ctx)
		}
	}
}

func (p *Poller) pollOnce(ctx context.Context) {
	// Skip this tick if the previous poll is still running (a slow/unreachable
	// node taking longer than the interval), so polls can't pile up.
	if !p.polling.CompareAndSwap(false, true) {
		p.log.Warn("poll still in progress, skipping tick")
		return
	}
	defer p.polling.Store(false)

	p.refreshAuthentik(ctx)

	clients := p.snapshotClients()
	results := make([]traefik.InstanceResult, len(clients))
	durations := make(map[string]time.Duration, len(clients))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i, c := range clients {
		wg.Add(1)
		go func(i int, c *traefik.Client) {
			defer wg.Done()
			start := time.Now()
			r := c.Scrape(ctx)
			d := time.Since(start)
			results[i] = r
			mu.Lock()
			durations[r.Name] = d
			mu.Unlock()
			if r.Err != nil {
				p.log.Warn("scrape failed", "instance", r.Name, "err", r.Err)
			}
		}(i, c)
	}
	wg.Wait()

	changed := p.store.Apply(results, time.Now().UnixMilli(), durations)
	if changed && p.notify != nil {
		p.notify.Broadcast()
	}
}

// refreshAuthentik refreshes the enrichment index at most once per TTL. On
// failure the store keeps the last-good index — enrichment degrades, the
// traefik poll is never blocked. Only called from pollOnce (single-flight via
// p.polling), so akRefresh needs no lock.
func (p *Poller) refreshAuthentik(ctx context.Context) {
	if p.ak == nil || time.Since(p.akRefresh) < authentikTTL {
		return
	}
	p.akRefresh = time.Now()
	ix, err := p.ak.Fetch(ctx)
	if err != nil {
		p.log.Warn("authentik refresh failed, keeping last-good index", "err", err)
		return
	}
	p.store.SetAuthentik(ix)
}
