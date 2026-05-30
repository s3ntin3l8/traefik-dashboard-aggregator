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
	"syscall"
	"time"

	"github.com/s3ntin3l8/traefik-viewer/internal/aggregator"
	"github.com/s3ntin3l8/traefik-viewer/internal/config"
	"github.com/s3ntin3l8/traefik-viewer/internal/httpapi"
	"github.com/s3ntin3l8/traefik-viewer/internal/loki"
	"github.com/s3ntin3l8/traefik-viewer/internal/sse"
	"github.com/s3ntin3l8/traefik-viewer/web"
)

func main() {
	cfgPath := flag.String("config", envOr("TV_CONFIG", "/config/config.yaml"), "path to config file")
	debug := flag.Bool("debug", os.Getenv("TV_DEBUG") != "", "enable debug logging")
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
	log.Info("loaded config", "instances", len(cfg.Instances), "poll", cfg.Server.PollInterval, "loki", cfg.LokiEnabled())

	store := aggregator.New(cfg)
	hub := sse.New()
	poller := aggregator.NewPoller(cfg, store, hub, log)
	lk := loki.New(cfg.Loki, 15*time.Second)

	spa, err := web.Dist()
	if err != nil {
		log.Error("embed spa", "err", err)
		os.Exit(1)
	}

	srv := httpapi.New(store, hub, lk, spa, log)
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
