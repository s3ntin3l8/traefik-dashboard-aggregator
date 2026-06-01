package traefik

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

// fixtureServer serves testdata/<name>.json for the matching /api path, and
// 404s anything without a fixture (mirroring Traefik's absent endpoints).
func fixtureServer(t *testing.T) *httptest.Server {
	t.Helper()
	routes := map[string]string{
		"/api/version":          "version",
		"/api/entrypoints":      "entrypoints",
		"/api/http/routers":     "http_routers",
		"/api/http/services":    "http_services",
		"/api/http/middlewares": "http_middlewares",
		"/api/certificates":     "certificates",
	}
	mux := http.NewServeMux()
	for path, name := range routes {
		file := filepath.Join("testdata", name+".json")
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			b, err := os.ReadFile(file)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(b)
		})
	}
	return httptest.NewServer(mux)
}

func TestScrapeTransformsFixtures(t *testing.T) {
	srv := fixtureServer(t)
	defer srv.Close()

	c := NewClient(config.Instance{Name: "mgmt", URL: srv.URL}, 5*time.Second)
	res := c.Scrape(context.Background())
	if res.Err != nil {
		t.Fatalf("scrape err: %v", res.Err)
	}
	if res.Version != "3.7.1" {
		t.Errorf("version = %q, want 3.7.1", res.Version)
	}
	if len(res.HTTPRouters) != 4 {
		t.Fatalf("routers = %d, want 4", len(res.HTTPRouters))
	}
	if len(res.HTTPServices) != 2 {
		t.Fatalf("services = %d, want 2", len(res.HTTPServices))
	}
	if len(res.Certificates) != 2 {
		t.Fatalf("certs = %d, want 2", len(res.Certificates))
	}
	if !res.Degraded {
		t.Error("expected Degraded=true (grafana has a DOWN backend)")
	}

	for i := range res.HTTPRouters {
		r := &res.HTTPRouters[i]
		switch r.Name {
		case "whoami@docker":
			if r.Host != "whoami.example.test" {
				t.Errorf("whoami host = %q", r.Host)
			}
			if !r.TLS || r.URL != "https://whoami.example.test" {
				t.Errorf("whoami tls/url wrong: %v %q", r.TLS, r.URL)
			}
			if r.ServiceStatus != "ok" || r.Status != "enabled" {
				t.Errorf("whoami status %q/%q, want enabled/ok", r.Status, r.ServiceStatus)
			}
			if r.ShortName != "whoami" || r.Provider != "docker" {
				t.Errorf("whoami shortName/provider = %q/%q", r.ShortName, r.Provider)
			}
		case "grafana@docker":
			if r.ServiceStatus != "degraded" {
				t.Errorf("grafana serviceStatus = %q, want degraded", r.ServiceStatus)
			}
			if r.Status != "warning" {
				t.Errorf("grafana status = %q, want warning (downgraded)", r.Status)
			}
		case "aerie@docker":
			if r.Status != "warning" {
				t.Errorf("aerie status = %q, want warning (error field present)", r.Status)
			}
			if len(r.Errors) != 1 {
				t.Errorf("aerie errors = %d, want 1", len(r.Errors))
			}
		}
	}

	for _, s := range res.HTTPServices {
		if s.Name == "grafana@docker" {
			if s.Status != "degraded" || s.ServersUp != 1 || s.ServersTotal != 2 {
				t.Errorf("grafana svc: status=%q up=%d total=%d", s.Status, s.ServersUp, s.ServersTotal)
			}
		}
	}

	for _, cert := range res.Certificates {
		if cert.Domain == "example.test" {
			if cert.Issuer != "Let's Encrypt" || cert.IssuerCN != "R12" {
				t.Errorf("cert issuer %q/%q", cert.Issuer, cert.IssuerCN)
			}
			if cert.KeyType != "RSA 4096" {
				t.Errorf("cert keyType = %q, want RSA 4096", cert.KeyType)
			}
		}
	}

	for _, m := range res.Middlewares {
		switch m.FullName {
		case "secure-headers@file":
			// type "headers" matches its config key exactly (fast path).
			if m.Config["stsSeconds"] != float64(31536000) {
				t.Errorf("secure-headers config = %v, want stsSeconds populated", m.Config)
			}
		case "https-redirect@file":
			// type "redirectscheme" but config is under "redirectScheme":
			// must be found case-insensitively.
			if m.Config["scheme"] != "https" || m.Config["permanent"] != true {
				t.Errorf("https-redirect config = %v, want scheme=https permanent=true", m.Config)
			}
		}
	}
}

func TestHostFromRule(t *testing.T) {
	cases := map[string]string{
		"Host(`a.example.test`)":               "a.example.test",
		"HostSNI(`db.example.test`)":           "db.example.test",
		"Host(`x.test`) && PathPrefix(`/api`)": "x.test",
		"PathPrefix(`/only`)":                  "",
	}
	for rule, want := range cases {
		if got := hostFromRule(rule); got != want {
			t.Errorf("hostFromRule(%q) = %q, want %q", rule, got, want)
		}
	}
}
