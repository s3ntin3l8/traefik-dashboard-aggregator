package authentik

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

func TestNewNilWhenUnconfigured(t *testing.T) {
	if c := New(config.Authentik{}, time.Second); c != nil {
		t.Error("New with empty config should return nil")
	}
	if c := New(config.Authentik{URL: "https://ak.example.com"}, time.Second); c != nil {
		t.Error("New without token should return nil")
	}
	if c := New(config.Authentik{Token: "t"}, time.Second); c != nil {
		t.Error("New without url should return nil")
	}
}

// TestFetchPaginates verifies the page loop follows pagination.next at the
// default page size and never sends page_size (which corrupts pagination
// metadata on authentik 2026.5.0).
func TestFetchPaginates(t *testing.T) {
	pages := map[string]string{
		"1": `{"pagination":{"next":2},"results":[
			{"name":"p1","external_host":"https://a.example.com","mode":"forward_single",
			 "assigned_application_name":"A","assigned_application_slug":"a",
			 "outpost_set":["Outpost authentik Embedded Outpost"]}]}`,
		"2": `{"pagination":{"next":0},"results":[
			{"name":"p2","external_host":"https://auth.example.com","mode":"forward_domain","cookie_domain":"example.com",
			 "assigned_application_name":"B","assigned_application_slug":"b",
			 "outpost_set":["Outpost edge"]}]}`,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("Authorization = %q, want Bearer tok", got)
		}
		if r.URL.Query().Has("page_size") {
			t.Error("page_size must never be sent")
		}
		body, ok := pages[r.URL.Query().Get("page")]
		if !ok {
			http.Error(w, `{"detail":"Invalid page."}`, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	c := New(config.Authentik{URL: srv.URL, Token: "tok"}, time.Second)
	ix, err := c.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}

	a, ok := ix.Lookup("a.example.com")
	if !ok || a.Application != "A" || a.Outpost != "authentik Embedded Outpost" {
		t.Errorf("page-1 app = %+v, ok=%v; want A via embedded outpost", a, ok)
	}
	b, ok := ix.Lookup("x.example.com")
	if !ok || b.Application != "B" || b.Outpost != "edge" {
		t.Errorf("page-2 domain app = %+v, ok=%v; want B via edge outpost", b, ok)
	}
}

// TestFetchRefusesCrossHostRedirect ensures the bearer token never follows a
// redirect to another host.
func TestFetchRefusesCrossHostRedirect(t *testing.T) {
	var leaked bool
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			leaked = true
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer evil.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evil.URL, http.StatusFound)
	}))
	defer srv.Close()

	c := New(config.Authentik{URL: srv.URL, Token: "tok"}, time.Second)
	if _, err := c.Fetch(context.Background()); err == nil {
		t.Error("Fetch should fail on a cross-host redirect")
	}
	if leaked {
		t.Error("bearer token followed a cross-host redirect")
	}
}

func TestFetchErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"detail":"Invalid token."}`, http.StatusForbidden)
	}))
	defer srv.Close()
	c := New(config.Authentik{URL: srv.URL, Token: "bad"}, time.Second)
	if _, err := c.Fetch(context.Background()); err == nil {
		t.Error("Fetch should surface a non-2xx status as an error")
	}
}
