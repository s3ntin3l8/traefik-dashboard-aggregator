package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// handleMe reflects forward-auth identity headers (e.g. authentik) for display
// only. Present headers are echoed; absent ones must yield empty strings, not a
// panic, so the no-proxy path still works.
func TestHandleMe(t *testing.T) {
	s := testServer(t, nil)

	// With injected identity headers.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("X-authentik-username", "alice")
	req.Header.Set("X-authentik-email", "alice@example.com")
	s.handleMe(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["user"] != "alice" {
		t.Errorf("user = %q, want alice", got["user"])
	}
	if got["email"] != "alice@example.com" {
		t.Errorf("email = %q, want alice@example.com", got["email"])
	}

	// Without headers (no proxy): empty identity, never a panic.
	rr = httptest.NewRecorder()
	s.handleMe(rr, httptest.NewRequest(http.MethodGet, "/api/me", nil))
	got = nil
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["user"] != "" {
		t.Errorf("user = %q, want empty without proxy", got["user"])
	}
}

func TestValidInstanceName(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"gateway", true},
		{"node-01", true},
		{"pve_mgmt", true},
		{"10.0.0.1", true},
		{"", false},
		{`a"b`, false},
		{"a b", false},
		{`{job="x"}`, false},
		{"a|json", false},
	}
	for _, c := range cases {
		if got := validInstanceName(c.in); got != c.want {
			t.Errorf("validInstanceName(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestClampWindow(t *testing.T) {
	max := 24 * time.Hour
	end := time.Unix(1_000_000, 0)

	// Window within the limit is unchanged.
	s, e := clampWindow(end.Add(-time.Hour), end, max)
	if !s.Equal(end.Add(-time.Hour)) || !e.Equal(end) {
		t.Errorf("in-bounds window altered: %v..%v", s, e)
	}

	// Oversized window is clamped to max before end.
	s, _ = clampWindow(end.Add(-1000*time.Hour), end, max)
	if !s.Equal(end.Add(-max)) {
		t.Errorf("oversized start = %v, want %v", s, end.Add(-max))
	}

	// Inverted window (start after end) collapses, never negative span.
	s, e = clampWindow(end.Add(time.Hour), end, max)
	if s.After(e) {
		t.Errorf("inverted window left start>end: %v..%v", s, e)
	}
}

// BUG-1: on a Loki error the tail window must NOT advance, or those lines are
// skipped forever once Loki recovers.
func TestAdvanceSince(t *testing.T) {
	prev := time.Unix(100, 0)
	now := time.Unix(200, 0)

	if got := advanceSince(prev, now, errors.New("boom")); !got.Equal(prev) {
		t.Errorf("on error advanceSince = %v, want unchanged %v", got, prev)
	}
	if got := advanceSince(prev, now, nil); !got.Equal(now) {
		t.Errorf("on success advanceSince = %v, want %v", got, now)
	}
}

func TestTailQueryStartOverlapsPreviousWindow(t *testing.T) {
	since := time.Unix(200, 0)
	want := since.Add(-logTailOverlap)

	if got := tailQueryStart(since); !got.Equal(want) {
		t.Errorf("tailQueryStart = %v, want %v", got, want)
	}
}

func TestHandleConfig(t *testing.T) {
	s := testServer(t, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	s.handleConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := got["lokiEnabled"]; !ok {
		t.Error("missing lokiEnabled in response")
	}
	if _, ok := got["authentikEnabled"]; !ok {
		t.Error("missing authentikEnabled in response")
	}
}

func TestHandleSnapshot(t *testing.T) {
	s := testServer(t, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	s.handleSnapshot(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
}
