package authentik

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/config"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/httpx"
)

// Client is a thin authentik API client (read-only, Bearer token).
type Client struct {
	base  string
	token string
	http  *http.Client
}

// New returns a Client, or nil if authentik enrichment is not configured.
func New(cfg config.Authentik, timeout time.Duration) *Client {
	if cfg.URL == "" || cfg.Token == "" {
		return nil
	}
	tr := &http.Transport{
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: cfg.InsecureSkipVerify},
		ForceAttemptHTTP2: true,
	}
	return &Client{
		base:  strings.TrimRight(cfg.URL, "/"),
		token: cfg.Token,
		http:  &http.Client{Timeout: timeout, Transport: tr, CheckRedirect: httpx.NoCrossHostRedirect},
	}
}

// rawProvider is one /api/v3/providers/proxy/ result. assigned_application_*
// comes from the provider list on purpose: /core/applications/ is
// policy-filtered per token and can silently hide apps.
type rawProvider struct {
	Name            string   `json:"name"`
	ExternalHost    string   `json:"external_host"`
	Mode            string   `json:"mode"` // proxy | forward_single | forward_domain
	CookieDomain    string   `json:"cookie_domain"`
	ApplicationName string   `json:"assigned_application_name"`
	ApplicationSlug string   `json:"assigned_application_slug"`
	OutpostSet      []string `json:"outpost_set"` // display strings: "Outpost <name>"
}

type providerPage struct {
	Pagination struct {
		Next float64 `json:"next"` // 0 when on the last page
	} `json:"pagination"`
	Results []rawProvider `json:"results"`
}

// maxPages bounds the pagination loop against a misbehaving server.
const maxPages = 50

// Fetch pulls all proxy providers and builds the host-matching index.
//
// Pagination iterates ?page=N at the server's default page size, following
// pagination.next until 0. Never pass page_size: observed (authentik 2026.5.0)
// to cap results while the metadata claims a single page — silent data loss.
func (c *Client) Fetch(ctx context.Context) (*Index, error) {
	var apps []App
	for page := 1; page <= maxPages; page++ {
		p, err := c.getPage(ctx, page)
		if err != nil {
			return nil, err
		}
		for _, r := range p.Results {
			apps = append(apps, App{
				Application:  r.ApplicationName,
				Slug:         r.ApplicationSlug,
				Provider:     r.Name,
				Mode:         r.Mode,
				Outpost:      firstOutpost(r.OutpostSet),
				ExternalHost: r.ExternalHost,
				CookieDomain: r.CookieDomain,
			})
		}
		if int(p.Pagination.Next) == 0 {
			break
		}
	}
	return NewIndex(apps), nil
}

func (c *Client) getPage(ctx context.Context, page int) (*providerPage, error) {
	u := c.base + "/api/v3/providers/proxy/?page=" + strconv.Itoa(page)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("authentik providers page %d: status %d: %s", page, resp.StatusCode, snippet(body))
	}
	var p providerPage
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("authentik decode: %w", err)
	}
	return &p, nil
}

// firstOutpost extracts the first outpost name, stripping authentik's
// "Outpost <name>" display prefix.
func firstOutpost(set []string) string {
	if len(set) == 0 {
		return ""
	}
	return strings.TrimPrefix(set[0], "Outpost ")
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 160 {
		return s[:160] + "…"
	}
	return s
}
