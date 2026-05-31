package aggregator

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/traefik"
)

// Notifier is called (with the fresh snapshot already in the store) whenever a
// poll produces a changed snapshot.
type Notifier interface {
	Broadcast()
}

// Poller periodically scrapes every instance and updates the store.
type Poller struct {
	store    *Store
	clients  []*traefik.Client
	interval time.Duration
	notify   Notifier
	log      *slog.Logger
	polling  atomic.Bool
}

// NewPoller wires clients for each configured instance.
func NewPoller(cfg *config.Config, store *Store, notify Notifier, log *slog.Logger) *Poller {
	clients := make([]*traefik.Client, 0, len(cfg.Instances))
	for _, in := range cfg.Instances {
		clients = append(clients, traefik.NewClient(in, cfg.Server.RequestTimeout))
	}
	return &Poller{
		store:    store,
		clients:  clients,
		interval: cfg.Server.PollInterval,
		notify:   notify,
		log:      log,
	}
}

// Run scrapes immediately, then on the configured interval until ctx is done.
func (p *Poller) Run(ctx context.Context) {
	p.pollOnce(ctx)
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
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

	results := make([]traefik.InstanceResult, len(p.clients))
	durations := make(map[string]time.Duration, len(p.clients))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i, c := range p.clients {
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
