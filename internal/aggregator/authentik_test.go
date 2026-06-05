package aggregator

import (
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/authentik"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/traefik"
)

func authentikMw(instance, fullName, address string) model.Middleware {
	return model.Middleware{
		Instance: instance,
		Name:     "forwardAuth-authentik",
		FullName: fullName,
		Type:     "forwardauth",
		Config:   map[string]any{"address": address},
	}
}

func testIndex() *authentik.Index {
	return authentik.NewIndex([]authentik.App{
		{Application: "homeassistant-mcp", Provider: "homeassistant-mcp", Mode: "forward_single",
			Outpost: "authentik Embedded Outpost", ExternalHost: "https://homeassistant.example.com"},
		{Application: "forwardAuth-authentik", Provider: "forwardAuth-authentik", Mode: "forward_domain",
			Outpost: "authentik Embedded Outpost", CookieDomain: "example.com"},
	})
}

func TestEnrichAuthentik(t *testing.T) {
	s := testStore()
	s.SetAuthentik(testIndex())

	res := traefik.InstanceResult{
		Name:    "mgmt",
		Version: "3.7.1",
		Middlewares: []model.Middleware{
			authentikMw("mgmt", "forwardAuth-authentik@file",
				"http://authentik-outpost:9000/outpost.goauthentik.io/auth/traefik"),
			{Instance: "mgmt", FullName: "other-fa@file", Type: "forwardauth",
				Config: map[string]any{"address": "http://oauth2-proxy:4180/"}},
		},
		HTTPRouters: []model.Router{
			{Instance: "mgmt", Name: "frigate@docker", Status: "enabled",
				Host:        "frigate.dockerhost.in.example.com",
				Middlewares: []string{"forwardAuth-authentik@file"}},
			{Instance: "mgmt", Name: "ha-mcp@docker", Status: "enabled",
				Host:        "homeassistant.example.com",
				Middlewares: []string{"forwardAuth-authentik@file"}},
			{Instance: "mgmt", Name: "plain@docker", Status: "enabled",
				Host:        "plain.example.com",
				Middlewares: []string{"other-fa@file"}},
		},
	}
	s.Apply([]traefik.InstanceResult{res}, time.Now().UnixMilli(), nil)
	snap := s.Snapshot()

	// Domain-mode match.
	frigate := snap.HTTPRouters[0]
	if frigate.Authentik == nil {
		t.Fatal("frigate router should be enriched")
	}
	if frigate.Authentik.Application != "forwardAuth-authentik" || frigate.Authentik.Mode != "forward_domain" {
		t.Errorf("frigate enrichment = %+v, want domain-wide app", frigate.Authentik)
	}

	// Exact single-app match beats the domain suffix.
	ha := snap.HTTPRouters[1]
	if ha.Authentik == nil || ha.Authentik.Application != "homeassistant-mcp" {
		t.Errorf("ha-mcp enrichment = %+v, want homeassistant-mcp", ha.Authentik)
	}

	// Non-authentik forwardauth: router untouched, middleware unmarked.
	if snap.HTTPRouters[2].Authentik != nil {
		t.Error("router behind a non-authentik forwardauth must not be enriched")
	}

	// Shared middleware aggregates both apps (sorted) and the outpost.
	var akMw, otherMw *model.Middleware
	for i := range snap.Middlewares {
		switch snap.Middlewares[i].FullName {
		case "forwardAuth-authentik@file":
			akMw = &snap.Middlewares[i]
		case "other-fa@file":
			otherMw = &snap.Middlewares[i]
		}
	}
	if akMw == nil || akMw.Authentik == nil {
		t.Fatal("authentik middleware should carry the marker")
	}
	wantApps := []string{"forwardAuth-authentik", "homeassistant-mcp"}
	if len(akMw.Authentik.Applications) != 2 ||
		akMw.Authentik.Applications[0] != wantApps[0] || akMw.Authentik.Applications[1] != wantApps[1] {
		t.Errorf("middleware apps = %v, want %v", akMw.Authentik.Applications, wantApps)
	}
	if len(akMw.Authentik.Outposts) != 1 || akMw.Authentik.Outposts[0] != "authentik Embedded Outpost" {
		t.Errorf("middleware outposts = %v", akMw.Authentik.Outposts)
	}
	if otherMw == nil || otherMw.Authentik != nil {
		t.Error("non-authentik forwardauth middleware must not carry the marker")
	}
}

// Without an index (enrichment disabled or first fetch pending), authentik
// middlewares still get the bare marker so the UI can badge them.
func TestEnrichAuthentikWithoutIndex(t *testing.T) {
	s := testStore()
	res := traefik.InstanceResult{
		Name: "mgmt",
		Middlewares: []model.Middleware{
			authentikMw("mgmt", "forwardAuth-authentik@file",
				"http://ak:9000/outpost.goauthentik.io/auth/traefik"),
		},
		HTTPRouters: []model.Router{
			{Instance: "mgmt", Name: "app@docker", Status: "enabled",
				Host: "app.example.com", Middlewares: []string{"forwardAuth-authentik@file"}},
		},
	}
	s.Apply([]traefik.InstanceResult{res}, time.Now().UnixMilli(), nil)
	snap := s.Snapshot()

	if snap.HTTPRouters[0].Authentik != nil {
		t.Error("router must not be enriched without an index")
	}
	mw := snap.Middlewares[0]
	if mw.Authentik == nil {
		t.Fatal("authentik middleware should still carry the marker")
	}
	if len(mw.Authentik.Applications) != 0 || len(mw.Authentik.Outposts) != 0 {
		t.Errorf("marker should be empty, got %+v", mw.Authentik)
	}
}

// A fresh index arriving between polls must flip the change flag even when the
// traefik data is identical, so the SSE hub broadcasts the enrichment.
func TestSetAuthentikTriggersChange(t *testing.T) {
	s := testStore()
	now := time.Now().UnixMilli()
	res := traefik.InstanceResult{
		Name: "mgmt",
		Middlewares: []model.Middleware{
			authentikMw("mgmt", "forwardAuth-authentik@file",
				"http://ak:9000/outpost.goauthentik.io/auth/traefik"),
		},
		HTTPRouters: []model.Router{
			{Instance: "mgmt", Name: "app@docker", Status: "enabled",
				Host: "app.example.com", Middlewares: []string{"forwardAuth-authentik@file"}},
		},
	}
	s.Apply([]traefik.InstanceResult{res}, now, nil)

	s.SetAuthentik(testIndex())
	if !s.Apply([]traefik.InstanceResult{res}, now+5000, nil) {
		t.Error("new authentik index should mark the snapshot as changed")
	}
	if s.Apply([]traefik.InstanceResult{res}, now+10000, nil) {
		t.Error("unchanged index + data should not report changed again")
	}
}
