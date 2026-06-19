package traefik

import (
	"testing"
)

func TestShortName(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"app@docker", "app"},
		{"my-service@file", "my-service"},
		{"noprovider", "noprovider"},
		{"", ""},
	}
	for _, c := range cases {
		if got := shortName(c.in); got != c.want {
			t.Errorf("shortName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestProviderOf(t *testing.T) {
	cases := []struct {
		name, fallback, want string
	}{
		{"app@docker", "", "docker"},
		{"app@file", "other", "file"},
		{"noprovider", "fallback", "fallback"},
	}
	for _, c := range cases {
		if got := providerOf(c.name, c.fallback); got != c.want {
			t.Errorf("providerOf(%q, %q) = %q, want %q", c.name, c.fallback, got, c.want)
		}
	}
}

func TestServiceStatusFromServers(t *testing.T) {
	cases := []struct {
		name    string
		status  map[string]string
		wantSt  string
		wantUp  int
		wantTot int
	}{
		{"empty", nil, "ok", 0, 0},
		{"all up", map[string]string{"a": "UP", "b": "UP"}, "ok", 2, 2},
		{"mixed", map[string]string{"a": "UP", "b": "DOWN"}, "degraded", 1, 2},
		{"all down", map[string]string{"a": "DOWN", "b": "DOWN"}, "down", 0, 2},
	}
	for _, c := range cases {
		st, up, tot := serviceStatusFromServers(c.status)
		if st != c.wantSt || up != c.wantUp || tot != c.wantTot {
			t.Errorf("%s: got (%q, %d, %d), want (%q, %d, %d)", c.name, st, up, tot, c.wantSt, c.wantUp, c.wantTot)
		}
	}
}

func TestParseTimeMs(t *testing.T) {
	if got := parseTimeMs(""); got != 0 {
		t.Errorf("empty string = %d, want 0", got)
	}
	if got := parseTimeMs("not-a-time"); got != 0 {
		t.Errorf("invalid = %d, want 0", got)
	}
	got := parseTimeMs("2024-06-15T00:00:00Z")
	if got == 0 {
		t.Error("valid RFC3339 should not be 0")
	}
}

func TestMiddlewareConfig(t *testing.T) {
	raw := rawMiddleware{
		"stripPrefix": map[string]any{"prefixes": []any{"/api"}},
		"headers":     map[string]any{"customRequestHeaders": map[string]any{"X-Custom": "val"}},
	}

	cfg := middlewareConfig(raw, "stripPrefix")
	if cfg["prefixes"] == nil {
		t.Error("expected prefixes in config")
	}

	cfg = middlewareConfig(raw, "")
	if len(cfg) != 0 {
		t.Error("empty type should return empty config")
	}

	cfg = middlewareConfig(raw, "nonexistent")
	if len(cfg) != 0 {
		t.Error("missing type should return empty config")
	}

	rawMixed := rawMiddleware{
		"redirectScheme": map[string]any{"scheme": "https"},
	}
	cfg = middlewareConfig(rawMixed, "redirectscheme")
	if cfg["scheme"] != "https" {
		t.Error("case-insensitive fallback should match redirectScheme")
	}
}

func TestKeySizeSuffix(t *testing.T) {
	if got := keySizeSuffix("RSA", 4096); got != "RSA 4096" {
		t.Errorf("keySizeSuffix(RSA, 4096) = %q, want %q", got, "RSA 4096")
	}
	if got := keySizeSuffix("ECDSA", 0); got != "ECDSA" {
		t.Errorf("keySizeSuffix(ECDSA, 0) = %q, want %q", got, "ECDSA")
	}
}

func TestServiceType(t *testing.T) {
	cases := []struct {
		rawType, provider, want string
	}{
		{"loadbalancer", "docker", "loadbalancer"}, // normal service — pass through
		{"weighted", "internal", "weighted"},       // explicit type wins even for internal
		{"", "docker", ""},                         // no type, non-internal → empty
		{"", "internal", "internal"},               // api@internal, dashboard@internal, etc.
		{"", "file", ""},                           // non-internal with no type → empty
	}
	for _, c := range cases {
		if got := serviceType(c.rawType, c.provider); got != c.want {
			t.Errorf("serviceType(%q, %q) = %q, want %q", c.rawType, c.provider, got, c.want)
		}
	}
}
