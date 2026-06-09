package httpx

import (
	"net/http"
	"net/url"
	"testing"
)

func TestNoCrossHostRedirect_AllowsSameHost(t *testing.T) {
	req := &http.Request{URL: &url.URL{Host: "loki.example.com"}}
	via := []*http.Request{{URL: &url.URL{Host: "loki.example.com"}}}
	if err := NoCrossHostRedirect(req, via); err != nil {
		t.Fatalf("same-host redirect should be allowed, got: %v", err)
	}
}

func TestNoCrossHostRedirect_BlocksCrossHost(t *testing.T) {
	req := &http.Request{URL: &url.URL{Host: "evil.example.com"}}
	via := []*http.Request{{URL: &url.URL{Host: "loki.example.com"}}}
	err := NoCrossHostRedirect(req, via)
	if err == nil {
		t.Fatal("cross-host redirect should be blocked")
	}
}

func TestNoCrossHostRedirect_MaxRedirects(t *testing.T) {
	req := &http.Request{URL: &url.URL{Host: "loki.example.com"}}
	via := make([]*http.Request, maxRedirects)
	for i := range via {
		via[i] = &http.Request{URL: &url.URL{Host: "loki.example.com"}}
	}
	err := NoCrossHostRedirect(req, via)
	if err == nil {
		t.Fatal("should error on max redirects")
	}
}

func TestNoCrossHostRedirect_AllowsFirstRedirect(t *testing.T) {
	req := &http.Request{URL: &url.URL{Host: "any.example.com"}}
	if err := NoCrossHostRedirect(req, nil); err != nil {
		t.Fatalf("first redirect (empty via) should always be allowed, got: %v", err)
	}
}
