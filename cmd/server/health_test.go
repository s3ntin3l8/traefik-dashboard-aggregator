package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthURL(t *testing.T) {
	cases := map[string]string{
		":8080":          "http://127.0.0.1:8080/healthz",
		"0.0.0.0:8080":   "http://127.0.0.1:8080/healthz",
		"[::]:8080":      "http://127.0.0.1:8080/healthz",
		"1.2.3.4:9000":   "http://1.2.3.4:9000/healthz",
		"not-an-address": "http://127.0.0.1:8080/healthz",
	}
	for in, want := range cases {
		if got := healthURL(in); got != want {
			t.Errorf("healthURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRunHealthcheck(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ok.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer bad.Close()

	// ok.URL is like http://127.0.0.1:PORT — strip the scheme for the addr arg.
	if got := runHealthcheck(ok.Listener.Addr().String()); got != 0 {
		t.Errorf("healthy probe exit = %d, want 0", got)
	}
	if got := runHealthcheck(bad.Listener.Addr().String()); got != 1 {
		t.Errorf("unhealthy probe exit = %d, want 1", got)
	}
	// Nothing listening on this port -> connection refused -> exit 1.
	if got := runHealthcheck("127.0.0.1:1"); got != 1 {
		t.Errorf("unreachable probe exit = %d, want 1", got)
	}
}
