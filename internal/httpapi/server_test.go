package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// SEC-5: every response carries hardening headers.
func TestSecurityHeaders(t *testing.T) {
	s := testServer(t, nil)
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	want := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	}
	for k, v := range want {
		if got := resp.Header.Get(k); got != v {
			t.Errorf("header %s = %q, want %q", k, got, v)
		}
	}
	if resp.Header.Get("Content-Security-Policy") == "" {
		t.Error("missing Content-Security-Policy header")
	}
}

// STAB-2: a panic in a handler becomes a 500, not a crashed process.
func TestRecoverMiddleware(t *testing.T) {
	boom := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	s := testServer(t, nil)
	h := recoverMiddleware(s.log, boom)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	h.ServeHTTP(rr, req) // must not panic out of ServeHTTP

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
}
