package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/aggregator"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/loki"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/overrides"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/sse"
)

// testServer builds a Server with instance editing disabled (no admin group
// configured -- the default, fail-closed posture). Use testServerWithAdmin
// for tests that need to exercise the write endpoints.
func testServer(t *testing.T, lk *loki.Client) *Server {
	t.Helper()
	return testServerWithAdmin(t, lk, nil)
}

// testServerWithAdmin builds a Server with instance editing enabled for the
// given admin groups (nil/empty leaves it disabled, same as testServer).
func testServerWithAdmin(t *testing.T, lk *loki.Client, adminGroups []string) *Server {
	t.Helper()
	return testServerWithOverridesDir(t, lk, adminGroups, t.TempDir())
}

// testServerWithOverridesDir is testServerWithAdmin with the overrides.json
// directory exposed, so a test can (e.g.) chmod it read-only afterward to
// exercise the persist-failure path.
func testServerWithOverridesDir(t *testing.T, lk *loki.Client, adminGroups []string, overridesDir string) *Server {
	t.Helper()
	cfg := &config.Config{
		Instances: []config.Instance{{Name: "node-1", URL: "https://x"}},
		Server:    config.Server{PollInterval: time.Hour, RequestTimeout: 5 * time.Second},
	}
	store := aggregator.New(cfg)
	hub := sse.New()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	poller := aggregator.NewPoller(cfg, store, hub, log)
	ov, err := overrides.Open(filepath.Join(overridesDir, "overrides.json"))
	if err != nil {
		t.Fatalf("overrides.Open: %v", err)
	}
	spa := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html></html>")}}
	return New(cfg, store, hub, lk, spa, log, "test", InstanceAdmin{
		Poller: poller, Overrides: ov, AdminGroups: adminGroups,
	})
}

// B-1: a client-supplied instance that isn't a plain identifier must be
// rejected before it can reach the Loki selector.
func TestLogsQueryRejectsInvalidInstance(t *testing.T) {
	lk := loki.New(config.Loki{URL: "http://loki.invalid"}, time.Second)
	s := testServer(t, lk)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, `/api/logs/query?instance={job="secrets"}`, nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for injected selector", rr.Code)
	}
}

func TestLogsQueryRejectsUnknownInstance(t *testing.T) {
	lk := loki.New(config.Loki{URL: "http://loki.invalid"}, time.Second)
	s := testServer(t, lk)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/query?instance=node-2", nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for unknown instance", rr.Code)
	}
}

// B-1: a valid instance must reach Loki as the server-built selector — the
// client's value only narrows it, never replaces it.
func TestLogsQueryBuildsServerSelector(t *testing.T) {
	var gotQuery string
	lokiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	defer lokiSrv.Close()

	s := testServer(t, loki.New(config.Loki{URL: lokiSrv.URL}, time.Second))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/query?instance=node-1", nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if want := `{job="docker", container="traefik", instance="node-1"}`; gotQuery != want {
		t.Errorf("loki query = %q, want %q", gotQuery, want)
	}
}

func TestLogsQueryAllowsEmptyInstance(t *testing.T) {
	var gotQuery string
	lokiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	defer lokiSrv.Close()

	s := testServer(t, loki.New(config.Loki{URL: lokiSrv.URL}, time.Second))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/query", nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if want := `{job="docker", container="traefik"}`; gotQuery != want {
		t.Errorf("loki query = %q, want %q", gotQuery, want)
	}
}

// When Loki isn't configured the proxy must refuse rather than NPE.
func TestLogsQueryWithoutLokiReturns503(t *testing.T) {
	s := testServer(t, nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/query", nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
}
