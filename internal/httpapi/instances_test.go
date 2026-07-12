package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

func TestAdminGate_NoGroupsConfiguredFailsClosed(t *testing.T) {
	s := testServer(t, nil) // no admin groups configured

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/instances", bytes.NewBufferString(`{"name":"x","url":"https://x"}`))
	req.Header.Set("X-authentik-groups", "admins") // even with a group header, no config = no admins
	s.handleCreateInstance(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (fail closed with no admin groups configured)", rr.Code)
	}
}

func TestAdminGate_WrongGroupRejected(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/instances", bytes.NewBufferString(`{"name":"x","url":"https://x"}`))
	req.Header.Set("X-authentik-groups", "viewers,everyone")
	s.handleCreateInstance(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for non-admin group", rr.Code)
	}
}

func TestAdminGate_MatchingGroupAllowed(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/instances", bytes.NewBufferString(`{"name":"new-node","url":"https://10.0.0.5"}`))
	req.Header.Set("X-authentik-groups", "viewers, admins")
	s.handleCreateInstance(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
}

func adminReq(method, target, body string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, bytes.NewBufferString(body))
	}
	r.Header.Set("X-authentik-groups", "admins")
	return r
}

func TestCreateInstance_HappyPath(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"new-node","url":"https://10.0.0.5","role":"node"}`))

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	var got struct {
		Instances []instanceView `json:"instances"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	found := false
	for _, in := range got.Instances {
		if in.Name == "new-node" {
			found = true
			if in.Source != "override" {
				t.Errorf("source = %q, want override for a UI-added instance", in.Source)
			}
		}
	}
	if !found {
		t.Fatal("new-node not present in response")
	}

	// It should also now be scrapeable/loggable -- InstanceNames must include it.
	if !instanceKnown(s.store.InstanceNames(), "new-node") {
		t.Error("new-node not reflected in store.InstanceNames() after create")
	}
}

func TestCreateInstance_DuplicateNameRejected(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	// node-1 is the base instance testServer seeds.
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"node-1","url":"https://10.0.0.5"}`))

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for duplicate name", rr.Code)
	}
}

func TestCreateInstance_BadURLSchemeRejected(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	cases := []string{
		`{"name":"x","url":"javascript:alert(1)"}`,
		`{"name":"x","url":"file:///etc/passwd"}`,
		`{"name":"x","url":"not-a-url"}`,
		`{"name":"x","url":""}`,
	}
	for _, body := range cases {
		rr := httptest.NewRecorder()
		s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", body))
		if rr.Code != http.StatusBadRequest {
			t.Errorf("body=%s: status = %d, want 400", body, rr.Code)
		}
	}
}

func TestUpdateInstance_HappyPath(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	req := adminReq(http.MethodPut, "/api/instances/node-1", `{"url":"https://10.0.0.77","dashboardURL":"https://d/"}`)
	req.SetPathValue("name", "node-1")
	s.handleUpdateInstance(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got struct {
		Instances []instanceView `json:"instances"`
	}
	json.NewDecoder(rr.Body).Decode(&got)
	for _, in := range got.Instances {
		if in.Name == "node-1" {
			if in.URL != "https://10.0.0.77" {
				t.Errorf("url = %q, want updated value", in.URL)
			}
			if in.Source != "file" {
				t.Errorf("source = %q, want file (base instance, edited)", in.Source)
			}
		}
	}
}

func TestUpdateInstance_UnknownNameRejected(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	req := adminReq(http.MethodPut, "/api/instances/ghost", `{"url":"https://x"}`)
	req.SetPathValue("name", "ghost")
	s.handleUpdateInstance(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for unknown instance", rr.Code)
	}
}

func TestDeleteInstance_HappyPath(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	// Add a second instance first so deleting one doesn't hit the last-instance guard.
	rr := httptest.NewRecorder()
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"second","url":"https://10.0.0.9"}`))
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup create failed: %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req := adminReq(http.MethodDelete, "/api/instances/second", "")
	req.SetPathValue("name", "second")
	s.handleDeleteInstance(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if instanceKnown(s.store.InstanceNames(), "second") {
		t.Error("deleted instance should no longer be in store.InstanceNames()")
	}
}

func TestDeleteInstance_LastInstanceRejected(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"}) // only "node-1" exists

	rr := httptest.NewRecorder()
	req := adminReq(http.MethodDelete, "/api/instances/node-1", "")
	req.SetPathValue("name", "node-1")
	s.handleDeleteInstance(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for deleting the last instance", rr.Code)
	}
	if !instanceKnown(s.store.InstanceNames(), "node-1") {
		t.Error("last instance should NOT have been removed")
	}
}

func TestDeleteInstance_UnknownNameRejected(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	req := adminReq(http.MethodDelete, "/api/instances/ghost", "")
	req.SetPathValue("name", "ghost")
	s.handleDeleteInstance(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for unknown instance", rr.Code)
	}
}

func TestListInstances_NotAdminGated(t *testing.T) {
	s := testServer(t, nil) // no admin groups configured at all

	rr := httptest.NewRecorder()
	s.handleListInstances(rr, httptest.NewRequest(http.MethodGet, "/api/instances", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (read is not admin-gated)", rr.Code)
	}
	// Sanity: the word basicAuth must never appear -- secrets must never be
	// serialized in the instance view.
	if bytes.Contains(rr.Body.Bytes(), []byte("basicAuth")) {
		t.Error("response must never contain basicAuth (secrets leaked to client)")
	}
}

func TestLogInstance_ReflectsLiveInstanceSet(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	// node-1 (base) is known.
	if inst, ok := s.logInstance(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/logs/query?instance=node-1", nil)); !ok || inst != "node-1" {
		t.Fatalf("base instance should be accepted: inst=%q ok=%v", inst, ok)
	}

	// Add a new instance via the admin API; it should immediately be accepted too.
	rr := httptest.NewRecorder()
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"fresh","url":"https://10.0.0.5"}`))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create failed: %d", rr.Code)
	}
	if inst, ok := s.logInstance(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/logs/query?instance=fresh", nil)); !ok || inst != "fresh" {
		t.Fatalf("newly-added instance should be accepted: inst=%q ok=%v", inst, ok)
	}
}

func TestIsAdmin_IgnoresWhitespaceOnlyGroupEntries(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("X-authentik-groups", " , ,  , admins")
	if !s.isAdmin(req) {
		t.Error("isAdmin should skip blank entries and still match admins")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("X-authentik-groups", " , ,  ,")
	if s.isAdmin(req) {
		t.Error("isAdmin should be false when every entry is blank")
	}
}

func TestInstanceExists_DeletedNameReturnsFalse(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	// node-1 is a base instance; marking it deleted must flip instanceExists
	// to false even though it's still present in s.baseInstances.
	ov := config.Overrides{Deleted: []string{"node-1"}}
	if s.instanceExists("node-1", ov) {
		t.Error("a base instance marked deleted should not exist")
	}
	if !s.instanceExists("node-1", config.Overrides{}) {
		t.Error("a base instance with no overrides should exist")
	}
}

func TestDecodeInstanceWrite_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/instances", bytes.NewBufferString("{not valid json"))
	if _, err := decodeInstanceWrite(req); err == nil {
		t.Fatal("expected an error decoding malformed JSON")
	}
}

func TestHandleCreateInstance_InvalidBodyAndName(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", "{not valid json"))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("malformed body: status = %d, want 400", rr.Code)
	}

	rr = httptest.NewRecorder()
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"has spaces","url":"https://x"}`))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("invalid name: status = %d, want 400", rr.Code)
	}
}

func TestHandleUpdateInstance_GateBodyNameAndURL(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	// No admin group header -> 403, never reaches the body/name/URL checks.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/instances/node-1", bytes.NewBufferString(`{"url":"https://x"}`))
	req.SetPathValue("name", "node-1")
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("no admin header: status = %d, want 403", rr.Code)
	}

	// Invalid path name.
	rr = httptest.NewRecorder()
	req = adminReq(http.MethodPut, `/api/instances/{job="x"}`, `{"url":"https://x"}`)
	req.SetPathValue("name", `{job="x"}`)
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("invalid path name: status = %d, want 400", rr.Code)
	}

	// Malformed body.
	rr = httptest.NewRecorder()
	req = adminReq(http.MethodPut, "/api/instances/node-1", "{not valid json")
	req.SetPathValue("name", "node-1")
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("malformed body: status = %d, want 400", rr.Code)
	}

	// Invalid URL scheme.
	rr = httptest.NewRecorder()
	req = adminReq(http.MethodPut, "/api/instances/node-1", `{"url":"javascript:alert(1)"}`)
	req.SetPathValue("name", "node-1")
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("bad url scheme: status = %d, want 400", rr.Code)
	}
}

func TestHandleUpdateInstance_UpsertReplacesExistingOverride(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	req := adminReq(http.MethodPut, "/api/instances/node-1", `{"url":"https://10.0.0.1"}`)
	req.SetPathValue("name", "node-1")
	rr := httptest.NewRecorder()
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first update: status = %d, want 200", rr.Code)
	}

	// A second edit of the same instance must replace the pending override,
	// not append a duplicate entry (exercises upsertOverride's "found" path).
	req = adminReq(http.MethodPut, "/api/instances/node-1", `{"url":"https://10.0.0.2"}`)
	req.SetPathValue("name", "node-1")
	rr = httptest.NewRecorder()
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("second update: status = %d, want 200", rr.Code)
	}
	var got struct {
		Instances []instanceView `json:"instances"`
	}
	json.NewDecoder(rr.Body).Decode(&got)
	if len(got.Instances) != 1 {
		t.Fatalf("expected exactly 1 instance (no duplicate override), got %d: %+v", len(got.Instances), got.Instances)
	}
	if got.Instances[0].URL != "https://10.0.0.2" {
		t.Errorf("url = %q, want the second edit's value", got.Instances[0].URL)
	}
}

func TestHandleDeleteInstance_GateAndInvalidName(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/instances/node-1", nil)
	req.SetPathValue("name", "node-1")
	s.handleDeleteInstance(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("no admin header: status = %d, want 403", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = adminReq(http.MethodDelete, `/api/instances/{job="x"}`, "")
	req.SetPathValue("name", `{job="x"}`)
	s.handleDeleteInstance(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("invalid path name: status = %d, want 400", rr.Code)
	}
}

func TestHandleDeleteInstance_KeepsOtherOverridesAndDeletions(t *testing.T) {
	s := testServerWithAdmin(t, nil, []string{"admins"})

	// Add two UI-only instances, then delete just one -- exercises the
	// "keep the others" branch of removeOverrideByName.
	for _, name := range []string{"second", "third"} {
		rr := httptest.NewRecorder()
		s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"`+name+`","url":"https://10.0.0.9"}`))
		if rr.Code != http.StatusCreated {
			t.Fatalf("setup create %s failed: %d", name, rr.Code)
		}
	}

	rr := httptest.NewRecorder()
	req := adminReq(http.MethodDelete, "/api/instances/second", "")
	req.SetPathValue("name", "second")
	s.handleDeleteInstance(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: status = %d, want 200", rr.Code)
	}
	if !instanceKnown(s.store.InstanceNames(), "third") {
		t.Error("deleting 'second' should not remove the unrelated 'third' override")
	}
	if instanceKnown(s.store.InstanceNames(), "second") {
		t.Error("'second' should be gone")
	}
}

func TestApplyOverrides_PersistFailureReturns500(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("permission checks don't apply when running as root")
	}
	dir := t.TempDir()
	s := testServerWithOverridesDir(t, nil, []string{"admins"}, dir)
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	defer os.Chmod(dir, 0o755)

	rr := httptest.NewRecorder()
	s.handleCreateInstance(rr, adminReq(http.MethodPost, "/api/instances", `{"name":"second","url":"https://10.0.0.9"}`))
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("create with unwritable overrides dir: status = %d, want 500", rr.Code)
	}

	req := adminReq(http.MethodPut, "/api/instances/node-1", `{"url":"https://10.0.0.1"}`)
	req.SetPathValue("name", "node-1")
	rr = httptest.NewRecorder()
	s.handleUpdateInstance(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("update with unwritable overrides dir: status = %d, want 500", rr.Code)
	}
}

func TestUpsertOverride(t *testing.T) {
	list := []config.OverrideInstance{{Name: "a", URL: "https://a"}, {Name: "b", URL: "https://b"}}

	replaced := upsertOverride(list, config.OverrideInstance{Name: "a", URL: "https://a2"})
	if len(replaced) != 2 || replaced[0].URL != "https://a2" {
		t.Errorf("expected in-place replace, got %+v", replaced)
	}

	appended := upsertOverride(list, config.OverrideInstance{Name: "c", URL: "https://c"})
	if len(appended) != 3 || appended[2].Name != "c" {
		t.Errorf("expected append for a new name, got %+v", appended)
	}
}

func TestRemoveOverrideByName(t *testing.T) {
	list := []config.OverrideInstance{{Name: "a"}, {Name: "b"}, {Name: "c"}}

	got := removeOverrideByName(list, "b")
	if len(got) != 2 || got[0].Name != "a" || got[1].Name != "c" {
		t.Errorf("expected [a c], got %+v", got)
	}

	got = removeOverrideByName(nil, "x")
	if len(got) != 0 {
		t.Errorf("removing from an empty list should stay empty, got %+v", got)
	}
}

func TestRemoveName(t *testing.T) {
	got := removeName([]string{"a", "b", "c"}, "b")
	if len(got) != 2 || got[0] != "a" || got[1] != "c" {
		t.Errorf("expected [a c], got %v", got)
	}
}

func TestAppendUnique(t *testing.T) {
	got := appendUnique([]string{"a"}, "b")
	if len(got) != 2 || got[1] != "b" {
		t.Errorf("expected [a b], got %v", got)
	}

	got = appendUnique([]string{"a", "b"}, "b")
	if len(got) != 2 {
		t.Errorf("appending an existing name should be a no-op, got %v", got)
	}
}
