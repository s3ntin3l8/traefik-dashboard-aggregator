package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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
