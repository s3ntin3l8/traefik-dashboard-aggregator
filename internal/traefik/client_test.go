package traefik

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

func TestGetJSON_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewClient(config.Instance{Name: "test", URL: srv.URL}, time.Second)
	var v map[string]any
	err := c.getJSON(context.Background(), "/tcp/middlewares", &v)
	if err == nil {
		t.Fatal("expected error for 404")
	}
	nf, ok := err.(errNotFound)
	if !ok {
		t.Fatalf("expected errNotFound, got %T: %v", err, err)
	}
	if nf.path != "/tcp/middlewares" {
		t.Errorf("path = %q, want /tcp/middlewares", nf.path)
	}
}

func TestGetJSON_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient(config.Instance{Name: "test", URL: srv.URL}, time.Second)
	var v map[string]any
	err := c.getJSON(context.Background(), "/http/routers", &v)
	if err == nil {
		t.Fatal("expected error for 401")
	}
	if err.Error() != "/http/routers: 401 unauthorized (check credentials)" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestGetJSON_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error details"))
	}))
	defer srv.Close()

	c := NewClient(config.Instance{Name: "test", URL: srv.URL}, time.Second)
	var v map[string]any
	err := c.getJSON(context.Background(), "/version", &v)
	if err == nil {
		t.Fatal("expected error for 500")
	}
}

func TestGetJSON_DecodeError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{invalid json`))
	}))
	defer srv.Close()

	c := NewClient(config.Instance{Name: "test", URL: srv.URL}, time.Second)
	var v map[string]any
	err := c.getJSON(context.Background(), "/version", &v)
	if err == nil {
		t.Fatal("expected decode error")
	}
}

func TestGetJSON_SetsBasicAuth(t *testing.T) {
	var gotUser, gotPass string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, gotPass, _ = r.BasicAuth()
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(config.Instance{
		Name:      "test",
		URL:       srv.URL,
		BasicAuth: config.BasicAuth{Username: "admin", Password: "s3cr3t"},
	}, time.Second)
	var v map[string]any
	if err := c.getJSON(context.Background(), "/version", &v); err != nil {
		t.Fatalf("getJSON: %v", err)
	}
	if gotUser != "admin" || gotPass != "s3cr3t" {
		t.Errorf("basic auth = %q/%q, want admin/s3cr3t", gotUser, gotPass)
	}
}

func TestGetJSON_SetsHostHeader(t *testing.T) {
	var gotHost string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(config.Instance{
		Name: "test",
		URL:  srv.URL,
		Host: "traefik.internal",
	}, time.Second)
	var v map[string]any
	if err := c.getJSON(context.Background(), "/version", &v); err != nil {
		t.Fatalf("getJSON: %v", err)
	}
	if gotHost != "traefik.internal" {
		t.Errorf("Host header = %q, want traefik.internal", gotHost)
	}
}

func TestGetJSON_CanceledContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(config.Instance{Name: "test", URL: srv.URL}, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var v map[string]any
	err := c.getJSON(ctx, "/version", &v)
	if err == nil {
		t.Fatal("expected error on canceled context")
	}
}

func TestSnippetTraefik(t *testing.T) {
	short := "hello"
	if got := snippet([]byte(short)); got != short {
		t.Errorf("snippet(short) = %q, want %q", got, short)
	}
	long := strings.Repeat("y", 200)
	got := snippet([]byte(long))
	if !strings.HasSuffix(got, "…") {
		t.Error("snippet(long) should end with ellipsis")
	}
	if got[:120] != strings.Repeat("y", 120) {
		t.Error("snippet(long) prefix should be 120 'y' chars")
	}
}

func TestErrNotFound(t *testing.T) {
	e := errNotFound{path: "/api/certificates"}
	if e.Error() != "not found: /api/certificates" {
		t.Errorf("Error() = %q, want not found: /api/certificates", e.Error())
	}
}
