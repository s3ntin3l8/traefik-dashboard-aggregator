package aggregator

import (
	"errors"
	"testing"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/traefik"
)

func testStore() *Store {
	return New(&config.Config{
		Server: config.Server{Domain: "example.test"},
		Instances: []config.Instance{
			{Name: "mgmt", URL: "https://192.168.2.157", DashboardURL: "https://d/"},
		},
	})
}

func okResult(name string, routers, downServices int) traefik.InstanceResult {
	r := traefik.InstanceResult{Name: name, Version: "3.7.1"}
	for i := 0; i < routers; i++ {
		r.HTTPRouters = append(r.HTTPRouters, model.Router{Name: "r", Status: "enabled"})
	}
	if downServices > 0 {
		r.Degraded = true
		r.HTTPServices = append(r.HTTPServices, model.Service{Name: "s", Status: "down"})
	}
	return r
}

func TestApplyDetectsChange(t *testing.T) {
	s := testStore()
	now := time.Now().UnixMilli()

	if !s.Apply([]traefik.InstanceResult{okResult("mgmt", 2, 0)}, now, nil) {
		t.Error("first apply should report changed")
	}
	// same data, later timestamp -> not changed
	if s.Apply([]traefik.InstanceResult{okResult("mgmt", 2, 0)}, now+5000, nil) {
		t.Error("identical data should NOT report changed (timestamps ignored)")
	}
	// different data -> changed
	if !s.Apply([]traefik.InstanceResult{okResult("mgmt", 3, 0)}, now+9000, nil) {
		t.Error("changed router count should report changed")
	}
}

func TestApplyKeepsLastGoodOnUnreachable(t *testing.T) {
	s := testStore()
	now := time.Now().UnixMilli()
	s.Apply([]traefik.InstanceResult{okResult("mgmt", 4, 0)}, now, nil)

	failed := traefik.InstanceResult{Name: "mgmt", Err: errors.New("connection refused")}
	s.Apply([]traefik.InstanceResult{failed}, now+1000, nil)

	snap := s.Snapshot()
	if len(snap.HTTPRouters) != 4 {
		t.Errorf("expected last-good 4 routers kept, got %d", len(snap.HTTPRouters))
	}
	in := snap.Instances[0]
	if in.Status != "unreachable" {
		t.Errorf("instance status = %q, want unreachable", in.Status)
	}
	if in.Error == "" {
		t.Error("expected error message on unreachable instance")
	}
	if in.Version != "3.7.1" {
		t.Errorf("version should persist from last-good, got %q", in.Version)
	}
}

func TestAnnotateCertStatus(t *testing.T) {
	now := time.Now().UnixMilli()
	day := int64(24 * 60 * 60 * 1000)
	certs := []model.Certificate{
		{Domain: "valid", NotAfter: now + 60*day},
		{Domain: "expiring", NotAfter: now + 10*day},
		{Domain: "expired", NotAfter: now - 2*day},
		{Domain: "unknown", NotAfter: 0},
	}
	annotateCertStatus(certs, now)
	want := map[string]string{"valid": "valid", "expiring": "expiring", "expired": "expired", "unknown": ""}
	for _, c := range certs {
		if c.Status != want[c.Domain] {
			t.Errorf("%s status = %q, want %q", c.Domain, c.Status, want[c.Domain])
		}
	}
}

func TestDegradedInstanceStatus(t *testing.T) {
	s := testStore()
	s.Apply([]traefik.InstanceResult{okResult("mgmt", 1, 1)}, time.Now().UnixMilli(), nil)
	if got := s.Snapshot().Instances[0].Status; got != "degraded" {
		t.Errorf("status = %q, want degraded", got)
	}
}
