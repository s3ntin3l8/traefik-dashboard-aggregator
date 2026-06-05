// Package authentik fetches proxy-provider metadata from an authentik server
// so forward-auth-protected routers can be annotated with the application,
// provider, and outpost guarding them.
//
// Matching is two-legged: the forward-auth middleware only signals "authentik"
// (its address path contains outpost.goauthentik.io); the actual application is
// resolved from the router's host — exactly how authentik itself routes a
// request, via the provider's external_host (forward_single) or cookie_domain
// (forward_domain).
package authentik

import (
	"sort"
	"strings"
)

// App is one proxy provider with its bound application and outpost.
type App struct {
	Application string // assigned application name; may be empty (unbound provider)
	Slug        string
	Provider    string
	Mode        string // forward_single | forward_domain
	Outpost     string // first outpost serving the provider; may be empty

	ExternalHost string // raw or normalized host; matching key for forward_single
	CookieDomain string // raw or normalized domain; matching key for forward_domain
}

// Index resolves a router host to the authentik app guarding it.
type Index struct {
	single map[string]*App // normalized external_host -> app (forward_single)
	domain []*App          // forward_domain apps, longest cookie_domain first
}

// NewIndex builds an Index from provider entries. Entries without a usable
// matching key are dropped.
func NewIndex(apps []App) *Index {
	ix := &Index{single: map[string]*App{}}
	for i := range apps {
		a := &apps[i]
		switch a.Mode {
		case "forward_single":
			if h := normalizeHost(a.ExternalHost); h != "" {
				a.ExternalHost = h
				ix.single[h] = a
			}
		case "forward_domain":
			if d := normalizeHost(a.CookieDomain); d != "" {
				a.CookieDomain = d
				ix.domain = append(ix.domain, a)
			}
		}
	}
	// Longest cookie_domain first so e.g. dev-01.in.example.com beats example.com.
	sort.SliceStable(ix.domain, func(i, j int) bool {
		return len(ix.domain[i].CookieDomain) > len(ix.domain[j].CookieDomain)
	})
	return ix
}

// Lookup resolves a router host: exact forward_single match first, then the
// longest forward_domain cookie_domain suffix (on a label boundary).
func (ix *Index) Lookup(host string) (*App, bool) {
	h := normalizeHost(host)
	if h == "" {
		return nil, false
	}
	if a, ok := ix.single[h]; ok {
		return a, true
	}
	for _, a := range ix.domain {
		if h == a.CookieDomain || strings.HasSuffix(h, "."+a.CookieDomain) {
			return a, true
		}
	}
	return nil, false
}

// normalizeHost reduces a host, URL, or domain to a bare lowercase hostname:
// scheme, port, path, and trailing dots/slashes are stripped.
func normalizeHost(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	// Strip a port, but not an IPv6 literal's colons.
	if i := strings.LastIndex(s, ":"); i >= 0 && !strings.Contains(s, "]") && strings.Count(s, ":") == 1 {
		s = s[:i]
	}
	return strings.Trim(s, ".")
}
