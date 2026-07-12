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

func TestHostOnly(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"https://10.0.0.1:8080", "10.0.0.1"},
		{"https://traefik.example.test", "traefik.example.test"},
		{"not-a-url", "not-a-url"},
		{"", ""},
	}
	for _, c := range cases {
		if got := hostOnly(c.in); got != c.want {
			t.Errorf("hostOnly(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestUsedMiddlewareCount(t *testing.T) {
	mws := []model.Middleware{
		{Name: "used", UsedBy: 3},
		{Name: "unused", UsedBy: 0},
		{Name: "also-used", UsedBy: 1},
	}
	if got := usedMiddlewareCount(mws); got != 2 {
		t.Errorf("usedMiddlewareCount = %d, want 2", got)
	}
}

func TestSetInstancesPreservesSurvivorState(t *testing.T) {
	s := testStore()
	now := time.Now().UnixMilli()
	s.Apply([]traefik.InstanceResult{okResult("mgmt", 4, 0)}, now, nil)

	changed := s.SetInstances([]config.Instance{
		{Name: "mgmt", URL: "https://192.168.2.157", DashboardURL: "https://new-dashboard/"},
	})
	if !changed {
		t.Error("changing dashboardURL should be reported as changed")
	}
	snap := s.Snapshot()
	if len(snap.HTTPRouters) != 4 {
		t.Errorf("survivor lost last-good routers: got %d, want 4", len(snap.HTTPRouters))
	}
	if snap.Instances[0].Status != "ok" {
		t.Errorf("survivor lost health status: got %q, want ok", snap.Instances[0].Status)
	}
	if snap.Instances[0].DashboardURL != "https://new-dashboard/" {
		t.Errorf("dashboardURL edit not applied: got %q", snap.Instances[0].DashboardURL)
	}
}

func TestSetInstancesPrunesRemoved(t *testing.T) {
	s := testStore()
	now := time.Now().UnixMilli()
	s.Apply([]traefik.InstanceResult{okResult("mgmt", 4, 0)}, now, nil)

	s.SetInstances([]config.Instance{{Name: "other", URL: "https://x"}})

	snap := s.Snapshot()
	if len(snap.Instances) != 1 || snap.Instances[0].Name != "other" {
		t.Fatalf("expected only 'other' to remain, got %+v", snap.Instances)
	}
	if len(snap.HTTPRouters) != 0 {
		t.Errorf("removed instance's routers should be pruned, got %d", len(snap.HTTPRouters))
	}

	// Re-adding "mgmt" by name should not resurrect its old last-good data --
	// it's a fresh instance from the store's perspective.
	s.SetInstances([]config.Instance{{Name: "mgmt", URL: "https://192.168.2.157"}})
	snap = s.Snapshot()
	if len(snap.HTTPRouters) != 0 {
		t.Errorf("re-added instance should start fresh, got %d routers", len(snap.HTTPRouters))
	}
	if snap.Instances[0].Status != "unreachable" {
		t.Errorf("re-added instance status = %q, want unreachable (unseeded)", snap.Instances[0].Status)
	}
}

func TestSetInstancesUnchangedReportsFalse(t *testing.T) {
	s := testStore()
	same := []config.Instance{{Name: "mgmt", URL: "https://192.168.2.157", DashboardURL: "https://d/"}}
	if changed := s.SetInstances(same); changed {
		t.Error("re-applying identical instance metadata should not report changed")
	}
}

func TestInstanceNamesReflectsEdits(t *testing.T) {
	s := testStore()
	if got := s.InstanceNames(); len(got) != 1 || got[0] != "mgmt" {
		t.Fatalf("InstanceNames = %v, want [mgmt]", got)
	}
	s.SetInstances([]config.Instance{
		{Name: "mgmt", URL: "https://192.168.2.157"},
		{Name: "new-node", URL: "https://192.168.2.99"},
	})
	got := s.InstanceNames()
	if len(got) != 2 || got[0] != "mgmt" || got[1] != "new-node" {
		t.Errorf("InstanceNames after edit = %v, want [mgmt new-node]", got)
	}
}

func TestRouterWarnings(t *testing.T) {
	rs := []model.Router{
		{Name: "ok", Status: "enabled"},
		{Name: "warn", Status: "warning"},
		{Name: "err", Status: "error"},
		{Name: "disabled", Status: "disabled"},
	}
	if got := routerWarnings(rs); got != 3 {
		t.Errorf("routerWarnings = %d, want 3", got)
	}
}
