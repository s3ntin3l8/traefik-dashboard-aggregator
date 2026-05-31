package traefik

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/httpx"
)

// Client talks to one downstream Traefik instance's REST API. It sends a
// configurable Host header (so the node's /api router matches when dialing by
// IP) and basic-auth credentials.
type Client struct {
	name string
	base string // e.g. https://192.168.2.157
	host string // Host header / SNI override
	user string
	pass string
	http *http.Client
}

// NewClient builds a Client for the given instance configuration.
func NewClient(in config.Instance, timeout time.Duration) *Client {
	tr := &http.Transport{
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: in.InsecureSkipVerify},
		ForceAttemptHTTP2: true,
	}
	if in.Host != "" {
		// Set SNI to the configured host so the served cert matches when we
		// dial by IP (verification is still governed by InsecureSkipVerify).
		tr.TLSClientConfig.ServerName = in.Host
	}
	return &Client{
		name: in.Name,
		base: strings.TrimRight(in.URL, "/"),
		host: in.Host,
		user: in.BasicAuth.Username,
		pass: in.BasicAuth.Password,
		http: &http.Client{Timeout: timeout, Transport: tr, CheckRedirect: httpx.NoCrossHostRedirect},
	}
}

// Name returns the instance name.
func (c *Client) Name() string { return c.name }

// errNotFound signals a 404 (e.g. /api/tcp/middlewares is absent on some
// versions) so the scraper can treat it as "empty/unsupported".
type errNotFound struct{ path string }

func (e errNotFound) Error() string { return "not found: " + e.path }

// getJSON fetches path under /api and decodes the JSON into v.
func (c *Client) getJSON(ctx context.Context, path string, v any) error {
	url := c.base + "/api" + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if c.host != "" {
		req.Host = c.host
	}
	if c.user != "" || c.pass != "" {
		req.SetBasicAuth(c.user, c.pass)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return errNotFound{path}
	case resp.StatusCode == http.StatusUnauthorized:
		return fmt.Errorf("%s: 401 unauthorized (check credentials)", path)
	case resp.StatusCode >= 300:
		return fmt.Errorf("%s: unexpected status %d: %s", path, resp.StatusCode, snippet(body))
	}
	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("%s: decode: %w", path, err)
	}
	return nil
}

func snippet(b []byte) string {
	const n = 120
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
