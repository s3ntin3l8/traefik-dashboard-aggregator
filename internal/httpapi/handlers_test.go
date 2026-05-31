package httpapi

import (
	"errors"
	"testing"
	"time"
)

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
