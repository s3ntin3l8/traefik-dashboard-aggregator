package loki

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

func TestSelectorForDefault(t *testing.T) {
	c := New(config.Loki{URL: "http://loki:3100"}, time.Second)
	if got, want := c.SelectorFor(""), `{job="docker", container="traefik"}`; got != want {
		t.Fatalf("SelectorFor(\"\") = %q, want %q", got, want)
	}
}

func TestSelectorForInstance(t *testing.T) {
	c := New(config.Loki{URL: "http://loki:3100"}, time.Second)
	if got, want := c.SelectorFor("node-1"), `{job="docker", container="traefik", instance="node-1"}`; got != want {
		t.Fatalf("SelectorFor(node-1) = %q, want %q", got, want)
	}
}

// A malicious instance value must be string-escaped so it cannot break out of
// the LogQL string literal and broaden/redirect the stream selector.
func TestSelectorForEscapesValue(t *testing.T) {
	c := New(config.Loki{URL: "http://loki:3100"}, time.Second)
	got := c.SelectorFor(`a"} | json | x="`)
	want := `{job="docker", container="traefik", instance="a\"} | json | x=\""}`
	if got != want {
		t.Fatalf("SelectorFor(evil) = %q, want %q", got, want)
	}
}

func TestSelectorForLabelMapping(t *testing.T) {
	c := New(config.Loki{URL: "http://loki:3100", LabelMapping: map[string]string{"job": "traefik"}}, time.Second)
	if got, want := c.SelectorFor("n"), `{job="traefik", instance="n"}`; got != want {
		t.Fatalf("SelectorFor with mapping = %q, want %q", got, want)
	}
}

// B-3: the credentialed client must not follow a redirect to a different host,
// so the Loki basic-auth header can never be replayed to an attacker-chosen
// destination.
func TestQueryRangeRefusesCrossHostRedirect(t *testing.T) {
	var leakedAuth bool
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			leakedAuth = true
		}
		_, _ = w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	defer evil.Close()
	loki := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evil.URL+"/loki/api/v1/query_range", http.StatusFound)
	}))
	defer loki.Close()

	c := New(config.Loki{URL: loki.URL, Username: "u", Password: "p"}, time.Second)
	_, err := c.QueryRange(context.Background(), QueryParams{Instance: "n"})
	if err == nil {
		t.Fatal("expected error on cross-host redirect, got nil")
	}
	if leakedAuth {
		t.Fatal("basic-auth header was replayed to the redirect target")
	}
}

// SEC-1: the caller cannot request an unbounded result count.
func TestNewReturnsNilOnEmptyURL(t *testing.T) {
	if c := New(config.Loki{}, time.Second); c != nil {
		t.Fatal("expected nil client for empty URL")
	}
}

func TestSnippet(t *testing.T) {
	short := "hello world"
	if got := snippet([]byte(short)); got != short {
		t.Errorf("snippet(short) = %q, want %q", got, short)
	}
	long := strings.Repeat("x", 200)
	got := snippet([]byte(long))
	if !strings.HasSuffix(got, "…") {
		t.Error("snippet(long) should end with ellipsis")
	}
	if got[:160] != strings.Repeat("x", 160) {
		t.Error("snippet(long) prefix should be 160 'x' chars")
	}
}

func TestQueryRangeSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"result":[{"stream":{"instance":"gw1"},"values":[["1700000000000000000","{\"RequestMethod\":\"GET\",\"DownstreamStatus\":200}"]]}]}}`))
	}))
	defer srv.Close()

	c := New(config.Loki{URL: srv.URL}, time.Second)
	entries, err := c.QueryRange(context.Background(), QueryParams{})
	if err != nil {
		t.Fatalf("QueryRange: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	if entries[0].Method != "GET" {
		t.Errorf("method = %q, want GET", entries[0].Method)
	}
	if entries[0].Status != 200 {
		t.Errorf("status = %d, want 200", entries[0].Status)
	}
}

func TestQueryRangeHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := New(config.Loki{URL: srv.URL}, time.Second)
	_, err := c.QueryRange(context.Background(), QueryParams{})
	if err == nil {
		t.Fatal("expected error on 500 response")
	}
}

func TestQueryRangeClampsLimit(t *testing.T) {
	var gotLimit, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotLimit = r.URL.Query().Get("limit")
		gotQuery = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	defer srv.Close()

	c := New(config.Loki{URL: srv.URL}, time.Second)
	_, err := c.QueryRange(context.Background(), QueryParams{Instance: "node-1", Limit: 1_000_000})
	if err != nil {
		t.Fatalf("QueryRange: %v", err)
	}
	if gotLimit != "5000" {
		t.Errorf("limit = %q, want clamped to 5000", gotLimit)
	}
	// The query must be the server-built selector, never client-controlled.
	if gotQuery != `{job="docker", container="traefik", instance="node-1"}` {
		t.Errorf("query = %q, want server-built selector", gotQuery)
	}
}
