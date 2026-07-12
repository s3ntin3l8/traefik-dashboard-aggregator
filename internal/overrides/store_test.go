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

func TestOpenRejectsMalformedJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "overrides.json")
	if err := os.WriteFile(path, []byte("{not valid json"), 0o644); err != nil {
		t.Fatalf("seed malformed file: %v", err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("expected an error opening a malformed overrides file")
	}
}

func TestOpenPropagatesReadErrorsOtherThanNotExist(t *testing.T) {
	// A directory at the target path makes os.ReadFile fail with something
	// other than os.ErrNotExist (the one error Open is allowed to swallow).
	dir := t.TempDir()
	path := filepath.Join(dir, "overrides.json")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("expected an error opening a path that is a directory")
	}
}

func TestSaveFailsWhenTargetIsANonEmptyDirectory(t *testing.T) {
	// WriteFile of the temp file succeeds (same, writable parent dir), but
	// os.Rename onto an existing non-empty directory fails -- exercising
	// Save's rename-failure branch (distinct from the write-failure one).
	dir := t.TempDir()
	path := filepath.Join(dir, "overrides.json")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(path, "keepme"), []byte("x"), 0o644); err != nil {
		t.Fatalf("seed directory: %v", err)
	}
	s := &Store{path: path}

	if err := s.Save(config.Overrides{}); err == nil {
		t.Fatal("expected an error renaming onto an existing non-empty directory")
	}
}

func TestSaveFailsOnUnwritableDir(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("permission checks don't apply when running as root")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "overrides.json")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	defer os.Chmod(dir, 0o755) // restore so t.TempDir() cleanup can remove it

	if err := s.Save(config.Overrides{Instances: []config.OverrideInstance{{Name: "x", URL: "https://x"}}}); err == nil {
		t.Fatal("expected an error writing to a read-only directory")
	}
	// A failed save must not update the cached value.
	if got := s.Get(); len(got.Instances) != 0 {
		t.Errorf("cached overrides changed despite a failed Save: %+v", got)
	}
}
