// Package config loads and validates the YAML configuration. Secrets are kept
// out of the file: ${ENV} / ${ENV:-default} references are expanded from the
// environment before parsing.
//
// NOTE: expansion runs over the whole file, so a bare "$name" (without braces)
// is also treated as a variable reference and replaced — an unset one becomes
// empty. If a value legitimately contains "$" (a password, or a regex/Host
// rule), supply it through a ${VAR} env reference rather than typing it inline.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level application configuration.
type Config struct {
	Server    Server     `yaml:"server"`
	Loki      Loki       `yaml:"loki"`
	Instances []Instance `yaml:"instances"`
}

// Server holds HTTP server and polling settings.
type Server struct {
	ListenAddr     string        `yaml:"listenAddr"`
	PollInterval   time.Duration `yaml:"pollInterval"`
	RequestTimeout time.Duration `yaml:"requestTimeout"`
	Domain         string        `yaml:"domain"`
}

// Loki configures the optional logs backend. Empty URL disables the Logs view.
type Loki struct {
	URL          string            `yaml:"url"`
	Username     string            `yaml:"username"`
	Password     string            `yaml:"password"`
	LabelMapping map[string]string `yaml:"labelMapping"`
}

// Instance is one downstream Traefik node to scrape.
type Instance struct {
	Name               string    `yaml:"name"`
	Role               string    `yaml:"role"` // "gateway" | "node" (default)
	URL                string    `yaml:"url"`
	Host               string    `yaml:"host"`
	DashboardURL       string    `yaml:"dashboardURL"`
	InsecureSkipVerify bool      `yaml:"insecureSkipVerify"`
	BasicAuth          BasicAuth `yaml:"basicAuth"`
}

// BasicAuth carries per-instance API credentials.
type BasicAuth struct {
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

const (
	defaultListenAddr     = ":8080"
	defaultPollInterval   = 15 * time.Second
	defaultRequestTimeout = 10 * time.Second
)

// Load reads, expands env references in, parses, and validates the config file.
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	return Parse(raw)
}

// Parse expands ${ENV} references and unmarshals + validates the bytes.
func Parse(raw []byte) (*Config, error) {
	expanded := os.Expand(string(raw), expand)

	var c Config
	if err := yaml.Unmarshal([]byte(expanded), &c); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	c.applyDefaults()
	if err := c.validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

// expand supports ${VAR} and ${VAR:-default}.
func expand(key string) string {
	name, def := key, ""
	if i := strings.Index(key, ":-"); i >= 0 {
		name, def = key[:i], key[i+2:]
	}
	if v, ok := os.LookupEnv(name); ok {
		return v
	}
	return def
}

func (c *Config) applyDefaults() {
	if c.Server.ListenAddr == "" {
		c.Server.ListenAddr = defaultListenAddr
	}
	if c.Server.PollInterval <= 0 {
		c.Server.PollInterval = defaultPollInterval
	}
	if c.Server.RequestTimeout <= 0 {
		c.Server.RequestTimeout = defaultRequestTimeout
	}
}

func (c *Config) validate() error {
	if len(c.Instances) == 0 {
		return fmt.Errorf("config: at least one instance is required")
	}
	seen := map[string]bool{}
	for i, in := range c.Instances {
		if in.Name == "" {
			return fmt.Errorf("config: instances[%d]: name is required", i)
		}
		if seen[in.Name] {
			return fmt.Errorf("config: duplicate instance name %q", in.Name)
		}
		seen[in.Name] = true
		if in.URL == "" {
			return fmt.Errorf("config: instance %q: url is required", in.Name)
		}
	}
	return nil
}

// LokiEnabled reports whether the logs backend is configured.
func (c *Config) LokiEnabled() bool { return c.Loki.URL != "" }
