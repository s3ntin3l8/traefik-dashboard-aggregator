package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/loki"
)

// handleMe reflects forward-auth identity headers (e.g. authentik) for display
// only. Present headers are echoed; absent ones must yield empty strings, not a
// panic, so the no-proxy path still works.
func TestHandleMe(t *testing.T) {
	s := testServer(t, nil)

	// With injected identity headers.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("X-authentik-username", "alice")
	req.Header.Set("X-authentik-email", "alice@example.com")
	s.handleMe(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["user"] != "alice" {
		t.Errorf("user = %q, want alice", got["user"])
	}
	if got["email"] != "alice@example.com" {
		t.Errorf("email = %q, want alice@example.com", got["email"])
	}

	// Without headers (no proxy): empty identity, never a panic.
	rr = httptest.NewRecorder()
	s.handleMe(rr, httptest.NewRequest(http.MethodGet, "/api/me", nil))
	got = nil
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["user"] != "" {
		t.Errorf("user = %q, want empty without proxy", got["user"])
	}
}

func TestValidInstanceName(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"gateway", true},
		{"node-01", true},
		{"pve_mgmt", true},
		{"10.0.0.1", true},
		{"", false},
		{`a"b`, false},
		{"a b", false},
		{`{job="x"}`, false},
		{"a|json", false},
	}
	for _, c := range cases {
		if got := validInstanceName(c.in); got != c.want {
			t.Errorf("validInstanceName(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestClampWindow(t *testing.T) {
	max := 24 * time.Hour
	end := time.Unix(1_000_000, 0)

	// Window within the limit is unchanged.
	s, e := clampWindow(end.Add(-time.Hour), end, max)
	if !s.Equal(end.Add(-time.Hour)) || !e.Equal(end) {
		t.Errorf("in-bounds window altered: %v..%v", s, e)
	}

	// Oversized window is clamped to max before end.
	s, _ = clampWindow(end.Add(-1000*time.Hour), end, max)
	if !s.Equal(end.Add(-max)) {
		t.Errorf("oversized start = %v, want %v", s, end.Add(-max))
	}

	// Inverted window (start after end) collapses, never negative span.
	s, e = clampWindow(end.Add(time.Hour), end, max)
	if s.After(e) {
		t.Errorf("inverted window left start>end: %v..%v", s, e)
	}
}

// BUG-1: on a Loki error the tail window must NOT advance, or those lines are
// skipped forever once Loki recovers.
func TestAdvanceSince(t *testing.T) {
	prev := time.Unix(100, 0)
	now := time.Unix(200, 0)

	if got := advanceSince(prev, now, errors.New("boom")); !got.Equal(prev) {
		t.Errorf("on error advanceSince = %v, want unchanged %v", got, prev)
	}
	if got := advanceSince(prev, now, nil); !got.Equal(now) {
		t.Errorf("on success advanceSince = %v, want %v", got, now)
	}
}

func TestTailQueryStartOverlapsPreviousWindow(t *testing.T) {
	since := time.Unix(200, 0)
	want := since.Add(-logTailOverlap)

	if got := tailQueryStart(since); !got.Equal(want) {
		t.Errorf("tailQueryStart = %v, want %v", got, want)
	}
}

func TestHandleConfig(t *testing.T) {
	s := testServer(t, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	s.handleConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := got["lokiEnabled"]; !ok {
		t.Error("missing lokiEnabled in response")
	}
	if _, ok := got["authentikEnabled"]; !ok {
		t.Error("missing authentikEnabled in response")
	}
	if got["version"] != "test" {
		t.Errorf("version = %v, want \"test\"", got["version"])
	}
}

func TestHandleSnapshot(t *testing.T) {
	s := testServer(t, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	s.handleSnapshot(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

func TestHandleEvents_SendsInitialSnapshot(t *testing.T) {
	s := testServer(t, nil)
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(srv.URL + "/api/events")
	if err != nil {
		t.Fatalf("GET /api/events: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("content-type = %q, want text/event-stream", ct)
	}

	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("reading first line: %v", err)
	}
	if !strings.HasPrefix(line, "event: snapshot") {
		t.Errorf("first SSE event type = %q, want 'event: snapshot'", strings.TrimSpace(line))
	}
}

func TestHandleEvents_SSECapacityExceeded(t *testing.T) {
	s := testServer(t, nil)
	limit := 2
	s.sseSlot = newLimiter(limit)

	for i := 0; i < limit; i++ {
		s.sseSlot.acquire()
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	s.handleEvents(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when at capacity", rr.Code)
	}
}

func TestHandleLogsTail_LokiNotConfigured(t *testing.T) {
	s := testServer(t, nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/tail", nil)
	s.handleLogsTail(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 without loki", rr.Code)
	}
}

func TestHandleLogsTail_SSECapacityExceeded(t *testing.T) {
	lk := lokiForTest(t)
	s := testServer(t, lk)
	limit := 2
	s.sseSlot = newLimiter(limit)

	for i := 0; i < limit; i++ {
		s.sseSlot.acquire()
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/tail", nil)
	s.handleLogsTail(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when at capacity", rr.Code)
	}
}

func lokiForTest(t *testing.T) *loki.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	t.Cleanup(srv.Close)
	return loki.New(config.Loki{URL: srv.URL}, time.Second)
}

func TestLogsQueryWithStartEnd(t *testing.T) {
	var gotStart, gotEnd string
	lokiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotStart = r.URL.Query().Get("start")
		gotEnd = r.URL.Query().Get("end")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	t.Cleanup(lokiSrv.Close)

	s := testServer(t, loki.New(config.Loki{URL: lokiSrv.URL}, time.Second))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/query?instance=node-1&start=1700000000000&end=1700001000000", nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if gotStart != "1700000000000000000" {
		t.Errorf("start = %q, want 1700000000000000000", gotStart)
	}
	if gotEnd != "1700001000000000000" {
		t.Errorf("end = %q, want 1700001000000000000", gotEnd)
	}
}

func TestLogsQueryLokiError(t *testing.T) {
	lokiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "loki internal error", http.StatusInternalServerError)
	}))
	defer lokiSrv.Close()

	s := testServer(t, loki.New(config.Loki{URL: lokiSrv.URL}, time.Second))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/query?instance=node-1", nil)
	s.handleLogsQuery(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 for loki error", rr.Code)
	}
}

func TestHandleLogsTail_ContextCancel(t *testing.T) {
	s := testServer(t, lokiForTest(t))
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/logs/tail", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /api/logs/tail: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType != "text/event-stream" {
		t.Errorf("content-type = %q, want text/event-stream", contentType)
	}

	cancel()
	io.Copy(io.Discard, resp.Body)
}
