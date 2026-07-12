// Package overrides persists UI-driven, non-secret instance-topology edits
// that layer on top of the env/config.yaml bootstrap (see internal/config's
// Overrides type and Merge function). This is the only component in the app
// that writes to disk -- config.yaml itself stays read-only.
package overrides

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
)

// Store guards concurrent access to a single overrides.json file and keeps
// the last-loaded/saved value cached in memory so reads never hit disk.
type Store struct {
	path string
	mu   sync.RWMutex
	cur  config.Overrides
}

// Open loads path if present. A missing file is the common case on first run
// (no edits made yet) and is treated as empty overrides, not an error.
func Open(path string) (*Store, error) {
	s := &Store{path: path}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read overrides: %w", err)
	}
	var ov config.Overrides
	if err := json.Unmarshal(raw, &ov); err != nil {
		return nil, fmt.Errorf("parse overrides %s: %w", path, err)
	}
	s.cur = ov
	return s, nil
}

// Get returns the current overrides value.
func (s *Store) Get() config.Overrides {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cur
}

// Save atomically persists ov (write to a temp file, then rename) and updates
// the cached value only on success, so a failed write never leaves Get()
// returning a value that isn't actually on disk.
func (s *Store) Save(ov config.Overrides) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("mkdir overrides dir: %w", err)
	}
	b, err := json.MarshalIndent(ov, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal overrides: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return fmt.Errorf("write overrides tmp: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename overrides: %w", err)
	}
	s.cur = ov
	return nil
}
