package config

import (
	"testing"
	"time"
)

func TestParseExpandsEnvAndDefaults(t *testing.T) {
	t.Setenv("MGMT_PASS", "s3cr3t")
	raw := []byte(`
server:
  pollInterval: 5s
instances:
  - name: mgmt
    url: https://192.168.2.157
    host: traefik.mgmt.example.test
    basicAuth:
      username: ${MGMT_USER:-admin}
      password: ${MGMT_PASS}
`)
	c, err := Parse(raw)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if c.Server.ListenAddr != ":8080" {
		t.Errorf("default listenAddr = %q, want :8080", c.Server.ListenAddr)
	}
	if c.Server.PollInterval != 5*time.Second {
		t.Errorf("pollInterval = %v, want 5s", c.Server.PollInterval)
	}
	if c.Server.RequestTimeout != 10*time.Second {
		t.Errorf("default requestTimeout = %v, want 10s", c.Server.RequestTimeout)
	}
	in := c.Instances[0]
	if in.BasicAuth.Username != "admin" {
		t.Errorf("username default = %q, want admin", in.BasicAuth.Username)
	}
	if in.BasicAuth.Password != "s3cr3t" {
		t.Errorf("password = %q, want s3cr3t (from env)", in.BasicAuth.Password)
	}
}

func TestParseRejectsNoInstances(t *testing.T) {
	if _, err := Parse([]byte(`server: {}`)); err == nil {
		t.Fatal("expected error for no instances")
	}
}

func TestParseRejectsDuplicateNames(t *testing.T) {
	raw := []byte(`
instances:
  - name: a
    url: https://x
  - name: a
    url: https://y
`)
	if _, err := Parse(raw); err == nil {
		t.Fatal("expected error for duplicate instance names")
	}
}

func TestLokiEnabled(t *testing.T) {
	c := &Config{}
	if c.LokiEnabled() {
		t.Error("LokiEnabled should be false with empty URL")
	}
	c.Loki.URL = "http://loki:3100"
	if !c.LokiEnabled() {
		t.Error("LokiEnabled should be true")
	}
}

func TestAuthentikEnabled(t *testing.T) {
	c := &Config{}
	if c.AuthentikEnabled() {
		t.Error("AuthentikEnabled should be false with empty config")
	}
	c.Authentik.URL = "http://authentik:9000"
	if c.AuthentikEnabled() {
		t.Error("AuthentikEnabled should be false with URL only (needs token)")
	}
	c.Authentik.Token = "tok"
	if !c.AuthentikEnabled() {
		t.Error("AuthentikEnabled should be true with both URL and token")
	}
}
