package authentik

import "testing"

// liveIndex mirrors the providers observed on a real authentik 2026.5.0
// instance (modes, overlapping cookie domains, a proxy-mode provider sharing
// its external_host with a forward_single one).
func liveIndex() *Index {
	return NewIndex([]App{
		{Application: "HomeAssistant", Provider: "HomeAssistant", Mode: "proxy",
			ExternalHost: "https://homeassistant.example.com"},
		{Application: "homeassistant-mcp", Provider: "homeassistant-mcp", Mode: "forward_single",
			Outpost: "authentik Embedded Outpost", ExternalHost: "https://homeassistant.example.com"},
		{Application: "Tautulli", Provider: "Tautulli", Mode: "forward_single",
			Outpost: "authentik Embedded Outpost", ExternalHost: "https://tautulli.unraid.in.example.com"},
		{Application: "forwardAuth-authentik", Provider: "forwardAuth-authentik", Mode: "forward_domain",
			Outpost: "authentik Embedded Outpost", ExternalHost: "https://authentik.example.com", CookieDomain: "example.com"},
		{Application: "dev-01 (forward auth)", Provider: "dev-01 forward auth", Mode: "forward_domain",
			Outpost: "dev-01", ExternalHost: "https://dev-01.in.example.com", CookieDomain: "dev-01.in.example.com"},
		{Application: "", Provider: "unbound", Mode: "forward_single",
			ExternalHost: "https://unbound.example.com"},
	})
}

func TestLookup(t *testing.T) {
	ix := liveIndex()
	tests := []struct {
		host    string
		wantApp string // matched App.Application; "" with ok=false means no match
		ok      bool
	}{
		// Exact forward_single match wins over the example.com domain suffix —
		// and over the proxy-mode provider sharing the same external_host.
		{"homeassistant.example.com", "homeassistant-mcp", true},
		{"tautulli.unraid.in.example.com", "Tautulli", true},
		// Longest cookie_domain suffix wins.
		{"app.dev-01.in.example.com", "dev-01 (forward auth)", true},
		{"dev-01.in.example.com", "dev-01 (forward auth)", true},
		// Falls through to the domain-wide provider.
		{"frigate.dockerhost.in.example.com", "forwardAuth-authentik", true},
		{"example.com", "forwardAuth-authentik", true},
		// Label boundary: a lookalike host must not suffix-match.
		{"evil-example.com", "", false},
		// Normalization on the lookup side.
		{"HOMEASSISTANT.example.com:443", "homeassistant-mcp", true},
		// Unbound provider still matches (empty application name).
		{"unbound.example.com", "", true},
		{"", "", false},
		{"unknown.elsewhere.net", "", false},
	}
	for _, tt := range tests {
		a, ok := ix.Lookup(tt.host)
		if ok != tt.ok {
			t.Errorf("Lookup(%q) ok = %v, want %v", tt.host, ok, tt.ok)
			continue
		}
		if ok && a.Application != tt.wantApp {
			t.Errorf("Lookup(%q) app = %q, want %q", tt.host, a.Application, tt.wantApp)
		}
	}
}

func TestLookupExcludesProxyMode(t *testing.T) {
	ix := NewIndex([]App{
		{Application: "ProxyOnly", Mode: "proxy", ExternalHost: "https://proxy-only.example.com"},
	})
	if _, ok := ix.Lookup("proxy-only.example.com"); ok {
		t.Error("proxy-mode provider must not be matchable (not reached via forwardAuth)")
	}
}

func TestNormalizeHost(t *testing.T) {
	tests := []struct{ in, want string }{
		{"https://Traefik-Viewer.Example.com:443/", "traefik-viewer.example.com"},
		{"http://authentik-outpost:9000/outpost.goauthentik.io/auth/traefik", "authentik-outpost"},
		{"example.com.", "example.com"},
		{"  Host.Example.COM  ", "host.example.com"},
		{"example.com", "example.com"},
		{"https://h.example.com/path?q=1#f", "h.example.com"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := normalizeHost(tt.in); got != tt.want {
			t.Errorf("normalizeHost(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
