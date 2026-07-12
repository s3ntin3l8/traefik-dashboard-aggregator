// Command server runs traefik-viewer: it polls the configured Traefik
// instances, aggregates them, and serves the SPA + JSON/SSE API.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/aggregator"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/httpapi"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/loki"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/overrides"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/sse"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/web"
)

// version is traefik-viewer's own build version, set at build time via
// -ldflags "-X main.version=...". Defaults to "dev" for local builds.
var version = "dev"

func main() {
	cfgPath := flag.String("config", envOr("TV_CONFIG", "/config/config.yaml"), "path to config file")
	debug := flag.Bool("debug", os.Getenv("TV_DEBUG") != "", "enable debug logging")
	healthcheck := flag.Bool("healthcheck", false, "probe the local /healthz endpoint and exit (for container HEALTHCHECK)")
	flag.Parse()

	level := slog.LevelInfo
	if *debug {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Error("load config", "err", err)
		os.Exit(1)
	}

	if *healthcheck {
		os.Exit(runHealthcheck(cfg.Server.ListenAddr))
	}

	// overrides.json holds UI-driven, non-secret instance-topology edits that
	// layer on top of the config.yaml/.env bootstrap (base). Persisted on a
	// separate writable path since config.yaml itself is typically mounted
	// read-only (see compose.yaml). A missing file just means no edits yet.
	ovPath := envOr("TV_OVERRIDES_PATH", "/data/overrides.json")
	ovStore, err := overrides.Open(ovPath)
	if err != nil {
		log.Error("load overrides", "path", ovPath, "err", err)
		os.Exit(1)
	}
	ov := ovStore.Get()
	effectiveInstances := config.Merge(cfg.Instances, &ov)
	if err := config.ValidateInstances(effectiveInstances); err != nil {
		log.Error("invalid effective instance list (config.yaml + overrides)", "err", err)
		os.Exit(1)
	}
	effectiveCfg := *cfg
	effectiveCfg.Instances = effectiveInstances

	log.Info("loaded config", "version", version, "instances", len(effectiveInstances), "baseInstances", len(cfg.Instances), "poll", cfg.Server.PollInterval, "loki", cfg.LokiEnabled(), "authentik", cfg.AuthentikEnabled())

	store := aggregator.New(&effectiveCfg)
	hub := sse.New()
	poller := aggregator.NewPoller(&effectiveCfg, store, hub, log)
	lk := loki.New(cfg.Loki, 15*time.Second)

	spa, err := web.Dist()
	if err != nil {
		log.Error("embed spa", "err", err)
		os.Exit(1)
	}

	adminGroups := splitAdminGroups(os.Getenv("TV_ADMIN_GROUPS"))
	if len(adminGroups) == 0 {
		log.Info("instance editing disabled: TV_ADMIN_GROUPS not set")
	}
	srv := httpapi.New(cfg, store, hub, lk, spa, log, version, httpapi.InstanceAdmin{
		Poller:      poller,
		Overrides:   ovStore,
		AdminGroups: adminGroups,
	})
	httpServer := &http.Server{
		Addr:              cfg.Server.ListenAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go poller.Run(ctx)

	go func() {
		log.Info("listening", "addr", cfg.Server.ListenAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// splitAdminGroups parses a comma-separated TV_ADMIN_GROUPS value. An empty
// or unset value yields no groups, which leaves instance editing disabled
// (see httpapi.InstanceAdmin) -- the fail-closed default.
func splitAdminGroups(v string) []string {
	var groups []string
	for _, g := range strings.Split(v, ",") {
		if g = strings.TrimSpace(g); g != "" {
			groups = append(groups, g)
		}
	}
	return groups
}
