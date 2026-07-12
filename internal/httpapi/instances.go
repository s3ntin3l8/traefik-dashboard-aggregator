// Instance admin endpoints: GET/POST/PUT/DELETE /api/instances. These let an
// operator edit the Traefik instance topology (name/url/host/dashboardURL/
// role/insecureSkipVerify) at runtime, on top of the env/config.yaml
// bootstrap. Per-instance credentials (BasicAuth) are never accepted here --
// they stay base-config-owned (see internal/config.Merge) so no secret is
// ever written to the overrides file or exposed in a response.
//
// The write endpoints (POST/PUT/DELETE) are gated on the X-authentik-groups
// header the app already reflects for display via /api/me. This makes that
// header load-bearing for authorization -- safe only under the invariant
// CLAUDE.md already states elsewhere: the upstream proxy strips any
// client-supplied identity headers and :8080 is not directly reachable. If no
// admin group is configured, writes are refused for everyone (fail closed).
package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

// maxInstanceBody bounds the size of a create/update request body.
const maxInstanceBody = 16 << 10

// instanceView is the wire representation of an effective instance. Secrets
// (BasicAuth) are intentionally absent from this type -- they must never
// reach the client.
type instanceView struct {
	Name               string `json:"name"`
	Role               string `json:"role,omitempty"`
	URL                string `json:"url"`
	Host               string `json:"host,omitempty"`
	DashboardURL       string `json:"dashboardURL,omitempty"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
	// Source is "file" when the instance originates from config.yaml/.env
	// (its credentials, if any, are base-owned and locked in the UI) or
	// "override" when it was added entirely through the UI (no credentials).
	Source string `json:"source"`
}

// instanceWriteRequest is the create/update request body. Name is read from
// the URL path on PUT, not from the body.
type instanceWriteRequest struct {
	Name               string `json:"name"`
	Role               string `json:"role"`
	URL                string `json:"url"`
	Host               string `json:"host"`
	DashboardURL       string `json:"dashboardURL"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
}

// isAdmin reports whether the request's X-authentik-groups header (populated
// by the upstream forward-auth proxy) intersects the configured admin group
// set. Fails CLOSED: an empty adminGroups set means no request is ever an
// admin, so instance editing is off by default until an operator opts in via
// TV_ADMIN_GROUPS. This is the single source of truth for both the write
// gate (adminGate) and the display-only "isAdmin" flag on /api/me -- the
// latter only toggles UI affordances, it grants nothing by itself.
func (s *Server) isAdmin(r *http.Request) bool {
	if len(s.adminGroups) == 0 {
		return false
	}
	for _, g := range strings.Split(r.Header.Get("X-authentik-groups"), ",") {
		if g = strings.TrimSpace(g); g == "" {
			continue
		}
		if _, ok := s.adminGroups[g]; ok {
			return true
		}
	}
	return false
}

// adminGate reports whether the request may proceed to a write handler,
// writing the appropriate 403 itself when it may not.
func (s *Server) adminGate(w http.ResponseWriter, r *http.Request) bool {
	if len(s.adminGroups) == 0 {
		http.Error(w, `{"error":"instance editing is disabled (no admin group configured)"}`, http.StatusForbidden)
		return false
	}
	if !s.isAdmin(r) {
		http.Error(w, `{"error":"forbidden: admin group required"}`, http.StatusForbidden)
		return false
	}
	return true
}

// effectiveInstances returns the base instance list with the current
// overrides layered on top (see config.Merge).
func (s *Server) effectiveInstances() []config.Instance {
	ov := s.overridesStore.Get()
	return config.Merge(s.baseInstances, &ov)
}

// instanceExists reports whether name resolves to a live instance under ov:
// present in base (and not deleted) or added via an override.
func (s *Server) instanceExists(name string, ov config.Overrides) bool {
	for _, n := range ov.Deleted {
		if n == name {
			return false
		}
	}
	for _, in := range s.baseInstances {
		if in.Name == name {
			return true
		}
	}
	for _, o := range ov.Instances {
		if o.Name == name {
			return true
		}
	}
	return false
}

func toInstanceViews(instances, base []config.Instance) []instanceView {
	baseNames := make(map[string]bool, len(base))
	for _, in := range base {
		baseNames[in.Name] = true
	}
	views := make([]instanceView, 0, len(instances))
	for _, in := range instances {
		src := "override"
		if baseNames[in.Name] {
			src = "file"
		}
		views = append(views, instanceView{
			Name: in.Name, Role: in.Role, URL: in.URL, Host: in.Host,
			DashboardURL: in.DashboardURL, InsecureSkipVerify: in.InsecureSkipVerify,
			Source: src,
		})
	}
	return views
}

func decodeInstanceWrite(r *http.Request) (instanceWriteRequest, error) {
	var req instanceWriteRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxInstanceBody)).Decode(&req); err != nil {
		return req, fmt.Errorf("decode request: %w", err)
	}
	return req, nil
}

// validInstanceURL requires an absolute http(s) URL. This is minimal SSRF
// hardening (reject javascript:/file:/relative targets); the admin gate is
// the primary control against arbitrary outbound scrape targets.
func validInstanceURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

// applyOverrides validates the effective instance list that ov would produce,
// persists ov on success, then live-applies it: the store's instance set is
// updated, the poller is reconfigured to scrape the new set immediately, and
// SSE subscribers are notified. On validation or persistence failure it
// writes the HTTP error itself and returns ok=false.
func (s *Server) applyOverrides(w http.ResponseWriter, ov config.Overrides) ([]config.Instance, bool) {
	eff := config.Merge(s.baseInstances, &ov)
	if err := config.ValidateInstances(eff); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadRequest)
		return nil, false
	}
	if err := s.overridesStore.Save(ov); err != nil {
		s.log.Error("persist instance overrides", "err", err)
		http.Error(w, `{"error":"failed to persist changes"}`, http.StatusInternalServerError)
		return nil, false
	}
	s.store.SetInstances(eff)
	s.poller.Reconfigure(eff, s.pollInterval, s.requestTimeout)
	s.hub.Broadcast()
	return eff, true
}

// handleListInstances returns the effective instance list (base + overrides),
// secrets stripped. Read-only: not admin-gated, same posture as /api/snapshot
// which already exposes equivalent (or more) instance metadata.
func (s *Server) handleListInstances(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"instances": toInstanceViews(s.effectiveInstances(), s.baseInstances)})
}

func (s *Server) handleCreateInstance(w http.ResponseWriter, r *http.Request) {
	if !s.adminGate(w, r) {
		return
	}
	req, err := decodeInstanceWrite(r)
	if err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if !validInstanceName(req.Name) {
		http.Error(w, `{"error":"invalid instance name"}`, http.StatusBadRequest)
		return
	}
	if !validInstanceURL(req.URL) {
		http.Error(w, `{"error":"url must be an absolute http(s) URL"}`, http.StatusBadRequest)
		return
	}

	ov := s.overridesStore.Get()
	if s.instanceExists(req.Name, ov) {
		http.Error(w, `{"error":"an instance with this name already exists"}`, http.StatusConflict)
		return
	}
	ov.Instances = upsertOverride(ov.Instances, config.OverrideInstance{
		Name: req.Name, Role: req.Role, URL: req.URL, Host: req.Host,
		DashboardURL: req.DashboardURL, InsecureSkipVerify: req.InsecureSkipVerify,
	})
	ov.Deleted = removeName(ov.Deleted, req.Name) // undo a prior delete of this same name, if any

	eff, ok := s.applyOverrides(w, ov)
	if !ok {
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]any{"instances": toInstanceViews(eff, s.baseInstances)})
}

func (s *Server) handleUpdateInstance(w http.ResponseWriter, r *http.Request) {
	if !s.adminGate(w, r) {
		return
	}
	name := r.PathValue("name")
	if !validInstanceName(name) {
		http.Error(w, `{"error":"invalid instance name"}`, http.StatusBadRequest)
		return
	}
	req, err := decodeInstanceWrite(r)
	if err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if !validInstanceURL(req.URL) {
		http.Error(w, `{"error":"url must be an absolute http(s) URL"}`, http.StatusBadRequest)
		return
	}

	ov := s.overridesStore.Get()
	if !s.instanceExists(name, ov) {
		http.Error(w, `{"error":"unknown instance"}`, http.StatusNotFound)
		return
	}
	ov.Instances = upsertOverride(ov.Instances, config.OverrideInstance{
		Name: name, Role: req.Role, URL: req.URL, Host: req.Host,
		DashboardURL: req.DashboardURL, InsecureSkipVerify: req.InsecureSkipVerify,
	})

	eff, ok := s.applyOverrides(w, ov)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{"instances": toInstanceViews(eff, s.baseInstances)})
}

func (s *Server) handleDeleteInstance(w http.ResponseWriter, r *http.Request) {
	if !s.adminGate(w, r) {
		return
	}
	name := r.PathValue("name")
	if !validInstanceName(name) {
		http.Error(w, `{"error":"invalid instance name"}`, http.StatusBadRequest)
		return
	}
	ov := s.overridesStore.Get()
	if !s.instanceExists(name, ov) {
		http.Error(w, `{"error":"unknown instance"}`, http.StatusNotFound)
		return
	}

	isBase := false
	for _, in := range s.baseInstances {
		if in.Name == name {
			isBase = true
			break
		}
	}
	ov.Instances = removeOverrideByName(ov.Instances, name)
	if isBase {
		ov.Deleted = appendUnique(ov.Deleted, name)
	}

	// Reject deleting the last instance before persisting anything.
	eff, ok := s.applyOverrides(w, ov)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{"instances": toInstanceViews(eff, s.baseInstances)})
}

func upsertOverride(list []config.OverrideInstance, oi config.OverrideInstance) []config.OverrideInstance {
	for i, o := range list {
		if o.Name == oi.Name {
			list[i] = oi
			return list
		}
	}
	return append(list, oi)
}

func removeOverrideByName(list []config.OverrideInstance, name string) []config.OverrideInstance {
	out := list[:0:0]
	for _, o := range list {
		if o.Name != name {
			out = append(out, o)
		}
	}
	return out
}

func removeName(list []string, name string) []string {
	out := list[:0:0]
	for _, n := range list {
		if n != name {
			out = append(out, n)
		}
	}
	return out
}

func appendUnique(list []string, name string) []string {
	for _, n := range list {
		if n == name {
			return list
		}
	}
	return append(list, name)
}
