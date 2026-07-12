package overrides

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

func TestOpenMissingFileYieldsEmptyOverrides(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "overrides.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got := s.Get()
	if len(got.Instances) != 0 || len(got.Deleted) != 0 {
		t.Errorf("expected empty overrides, got %+v", got)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "overrides.json")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	ov := config.Overrides{
		Instances: []config.OverrideInstance{{Name: "gateway", URL: "https://10.0.0.9"}},
		Deleted:   []string{"old-node"},
	}
	if err := s.Save(ov); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if got := s.Get(); len(got.Instances) != 1 || got.Instances[0].URL != "https://10.0.0.9" {
		t.Errorf("Get after Save = %+v", got)
	}

	// Reopen from disk to confirm the write actually landed.
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("re-Open: %v", err)
	}
	got := s2.Get()
	if len(got.Instances) != 1 || got.Instances[0].Name != "gateway" {
		t.Errorf("round-trip mismatch: %+v", got)
	}
	if len(got.Deleted) != 1 || got.Deleted[0] != "old-node" {
		t.Errorf("round-trip deleted mismatch: %+v", got)
	}
}

func TestSaveNoTempFileLeftBehind(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "overrides.json")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.Save(config.Overrides{}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file should not survive a successful save")
	}
}
