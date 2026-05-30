// Package loki queries a Loki backend for the Logs view. Traefik's REST API
// does not expose logs, so logs come from the user's central Loki. Raw lines
// are normalized into the LogEntry shape the SPA expects.
package loki

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/s3ntin3l8/traefik-viewer/internal/config"
)

// Client is a thin Loki HTTP client.
type Client struct {
	base   string
	user   string
	pass   string
	labels map[string]string
	http   *http.Client
}

// New returns a Client, or nil if Loki is not configured.
func New(cfg config.Loki, timeout time.Duration) *Client {
	if cfg.URL == "" {
		return nil
	}
	return &Client{
		base:   strings.TrimRight(cfg.URL, "/"),
		user:   cfg.Username,
		pass:   cfg.Password,
		labels: cfg.LabelMapping,
		http:   &http.Client{Timeout: timeout},
	}
}

// LogEntry is the normalized log line the SPA renders.
type LogEntry struct {
	ID         string         `json:"id"`
	TS         int64          `json:"ts"`    // unix ms
	Kind       string         `json:"kind"`  // access | system
	Level      string         `json:"level"` // info | warning | error
	Instance   string         `json:"instance"`
	App        string         `json:"app,omitempty"`
	Router     string         `json:"router,omitempty"`
	Service    string         `json:"service,omitempty"`
	Method     string         `json:"method,omitempty"`
	Path       string         `json:"path,omitempty"`
	Host       string         `json:"host,omitempty"`
	Status     int            `json:"status,omitempty"`
	DurationMs int            `json:"durationMs,omitempty"`
	Size       int            `json:"size,omitempty"`
	ClientIP   string         `json:"clientIP,omitempty"`
	Proto      string         `json:"proto,omitempty"`
	Msg        string         `json:"msg,omitempty"`
	Fields     map[string]any `json:"fields,omitempty"`
}

// QueryParams describe a Loki query_range request from the UI.
type QueryParams struct {
	Query string // LogQL; empty -> default selector
	Start time.Time
	End   time.Time
	Limit int
}

type lokiQueryResponse struct {
	Data struct {
		Result []struct {
			Stream map[string]string `json:"stream"`
			Values [][2]string       `json:"values"` // [ts_ns, line]
		} `json:"result"`
	} `json:"data"`
}

// DefaultSelector builds a base LogQL selector from the configured label map,
// defaulting to {job="traefik"}.
func (c *Client) DefaultSelector() string {
	if len(c.labels) == 0 {
		return `{job="traefik"}`
	}
	parts := make([]string, 0, len(c.labels))
	for k, v := range c.labels {
		parts = append(parts, fmt.Sprintf("%s=%q", k, v))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// QueryRange fetches and normalizes log lines for the given window.
func (c *Client) QueryRange(ctx context.Context, p QueryParams) ([]LogEntry, error) {
	q := p.Query
	if strings.TrimSpace(q) == "" {
		q = c.DefaultSelector()
	}
	if p.Limit <= 0 {
		p.Limit = 500
	}
	u := c.base + "/loki/api/v1/query_range"
	vals := url.Values{}
	vals.Set("query", q)
	vals.Set("start", strconv.FormatInt(p.Start.UnixNano(), 10))
	vals.Set("end", strconv.FormatInt(p.End.UnixNano(), 10))
	vals.Set("limit", strconv.Itoa(p.Limit))
	vals.Set("direction", "backward")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u+"?"+vals.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if c.user != "" || c.pass != "" {
		req.SetBasicAuth(c.user, c.pass)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("loki query_range: status %d: %s", resp.StatusCode, snippet(body))
	}
	var lr lokiQueryResponse
	if err := json.Unmarshal(body, &lr); err != nil {
		return nil, fmt.Errorf("loki decode: %w", err)
	}

	out := []LogEntry{}
	for _, stream := range lr.Data.Result {
		for _, v := range stream.Values {
			out = append(out, normalize(v[0], v[1], stream.Stream))
		}
	}
	return out, nil
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 160 {
		return s[:160] + "…"
	}
	return s
}
