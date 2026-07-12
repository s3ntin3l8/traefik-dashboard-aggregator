package aggregator

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/sse"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/traefik"
)

func TestNewPoller_CreatesClients(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{
			{Name: "node-1", URL: "https://10.0.0.1"},
			{Name: "node-2", URL: "https://10.0.0.2"},
		},
		Server: config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)
	if len(p.clients) != 2 {
		t.Errorf("clients = %d, want 2", len(p.clients))
	}
	if p.interval != 30*time.Second {
		t.Errorf("interval = %v, want 30s", p.interval)
	}
}

func TestNewPoller_NilAuthentikWhenNotConfigured(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "n1", URL: "https://x"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)
	if p.ak != nil {
		t.Error("expected nil authentik client when not configured")
	}
}

func TestPollOnce_SkipsWhenAlreadyRunning(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "node-1", URL: "https://10.0.0.1"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	p.polling.Store(true)
	p.pollOnce(context.Background())

	snap := store.Snapshot()
	for _, in := range snap.Instances {
		if in.LastScrape != 0 {
			t.Errorf("pollOnce should be skipped when polling flag is set, but lastScrape=%d", in.LastScrape)
		}
	}
}

func TestRefreshAuthentik_RespectsTTL(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"results":[]}`))
	}))
	defer srv.Close()

	cfg := &config.Config{
		Instances: []config.Instance{{Name: "n1", URL: "https://x"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
		Authentik: config.Authentik{URL: srv.URL, Token: "tok"},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	p.refreshAuthentik(ctx)
	p.refreshAuthentik(ctx)

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("authentik fetch calls = %d, want 1 (second call should be skipped by TTL)", got)
	}
}

func TestRefreshAuthentik_NilClient(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "n1", URL: "https://x"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	p.refreshAuthentik(context.Background())
}

func TestRefreshAuthentik_SuccessSetsIndex(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"results":[{"pk":"1","name":"app1","provider":{"pk":"2","name":"prov1","outpost_set":[{"pk":"3","name":"outpost1"}],"application":{"slug":"app1"},"mode":"forward_single","property_mappings":[],"external_host":"https://app1.example.com"},"binding":{"domain":"example.com"}}]}`))
	}))
	defer srv.Close()

	cfg := &config.Config{
		Instances: []config.Instance{{Name: "n1", URL: "https://x"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
		Authentik: config.Authentik{URL: srv.URL, Token: "tok"},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	p.refreshAuthentik(context.Background())

	ix := store.authentik
	if ix == nil {
		t.Fatal("expected authentik index to be set after refresh")
	}
}

// stubNotifier tracks whether Broadcast was called.
type stubNotifier struct{ called bool }

func (n *stubNotifier) Broadcast() { n.called = true }

func TestPollOnce_BroadcastsOnScrape(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "test", URL: "https://unreachable.invalid"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 100 * time.Millisecond},
	}
	store := New(cfg)
	notif := &stubNotifier{}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, notif, log)

	p.pollOnce(context.Background())

	if !notif.called {
		t.Error("expected Broadcast to be called after pollOnce (even with errors, the first snapshot always differs from the empty one)")
	}
}

func TestPollOnce_UpdatesStoreWithResult(t *testing.T) {
	result := []traefik.InstanceResult{{
		Name:        "n1",
		Version:     "3.7.1",
		HTTPRouters: []model.Router{{Name: "r1", Status: "enabled"}},
		Degraded:    false,
	}}
	now := time.Now().UnixMilli()
	store := New(&config.Config{
		Instances: []config.Instance{{Name: "n1", URL: "https://x"}},
		Server:    config.Server{Domain: "test.example"},
	})
	store.Apply(result, now, nil)

	snap := store.Snapshot()
	if len(snap.HTTPRouters) != 1 {
		t.Errorf("routers = %d, want 1", len(snap.HTTPRouters))
	}
	if snap.Instances[0].Status != "ok" {
		t.Errorf("status = %q, want ok", snap.Instances[0].Status)
	}
}

func TestReconfigureSwapsClientsAndInterval(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "node-1", URL: "https://10.0.0.1"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	p.Reconfigure([]config.Instance{
		{Name: "node-1", URL: "https://10.0.0.1"},
		{Name: "node-2", URL: "https://10.0.0.2"},
	}, 5*time.Second, 2*time.Second)

	if got := p.snapshotClients(); len(got) != 2 {
		t.Errorf("clients after Reconfigure = %d, want 2", len(got))
	}
	if got := p.currentInterval(); got != 5*time.Second {
		t.Errorf("interval after Reconfigure = %v, want 5s", got)
	}
}

func TestReconfigureQueuesReloadSignal(t *testing.T) {
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "node-1", URL: "https://10.0.0.1"}},
		Server:    config.Server{PollInterval: 30 * time.Second, RequestTimeout: 5 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	p.Reconfigure(cfg.Instances, 30*time.Second, 5*time.Second)
	select {
	case <-p.reload:
	default:
		t.Fatal("expected a reload signal to be queued after Reconfigure")
	}

	// Calling Reconfigure twice in a row without draining should coalesce,
	// not block on a full channel.
	done := make(chan struct{})
	go func() {
		p.Reconfigure(cfg.Instances, 30*time.Second, 5*time.Second)
		p.Reconfigure(cfg.Instances, 30*time.Second, 5*time.Second)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Reconfigure blocked on a full reload channel instead of coalescing")
	}
}

func TestRunPicksUpReconfigureImmediately(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"Version":"3.7.1"}`))
	}))
	defer srv.Close()

	cfg := &config.Config{
		Instances: []config.Instance{{Name: "node-1", URL: srv.URL}},
		// Long interval: if Reconfigure didn't wake Run immediately, the test
		// would time out waiting for the natural tick.
		Server: config.Server{PollInterval: time.Hour, RequestTimeout: 2 * time.Second},
	}
	store := New(cfg)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := NewPoller(cfg, store, sse.New(), log)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go p.Run(ctx)

	// Wait for the initial poll Run() fires on entry.
	deadline := time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(&calls) < 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if atomic.LoadInt32(&calls) < 1 {
		t.Fatal("initial poll never happened")
	}

	before := atomic.LoadInt32(&calls)
	p.Reconfigure(cfg.Instances, time.Hour, 2*time.Second)

	deadline = time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(&calls) <= before && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&calls); got <= before {
		t.Errorf("Reconfigure should trigger an immediate poll; calls before=%d after=%d", before, got)
	}
}

func TestClientName(t *testing.T) {
	c := traefik.NewClient(config.Instance{Name: "gw"}, time.Second)
	if c.Name() != "gw" {
		t.Errorf("Name() = %q, want gw", c.Name())
	}
}
