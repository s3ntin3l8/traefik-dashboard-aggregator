package aggregator

import (
	"sort"
	"strings"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/authentik"
	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
)

// authentikSignature identifies an authentik forward-auth middleware by the
// outpost path embedded in its address. The address host is a per-node
// internal name (e.g. authentik-outpost vs authentik_server) and must not be
// used for detection.
const authentikSignature = "outpost.goauthentik.io"

// SetAuthentik stores the latest authentik index; the next snapshot rebuild
// picks it up. A nil index disables app/provider resolution (middlewares still
// get the authentik marker).
func (s *Store) SetAuthentik(ix *authentik.Index) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authentik = ix
}

// enrichAuthentik annotates the freshly built snapshot. It runs inside build()
// — before hashing — so authentik changes ride the normal change-detection →
// SSE broadcast path. Caller must hold the lock.
//
// The join is two-legged: the middleware only signals "authentik"; the
// application/provider/outpost are resolved from the router's host, exactly
// how authentik routes a request. A shared middleware therefore aggregates the
// distinct apps of all routers using it.
func (s *Store) enrichAuthentik(snap *model.Snapshot) {
	// instance + fullName -> middleware, for resolving router middleware refs.
	type mwKey struct{ instance, fullName string }
	mws := make(map[mwKey]*model.Middleware, len(snap.Middlewares))
	apps := map[*model.Middleware]map[string]bool{}
	outposts := map[*model.Middleware]map[string]bool{}
	for i := range snap.Middlewares {
		m := &snap.Middlewares[i]
		mws[mwKey{m.Instance, m.FullName}] = m
		if isAuthentikMiddleware(m) {
			m.Authentik = &model.MiddlewareAuthentik{}
			apps[m] = map[string]bool{}
			outposts[m] = map[string]bool{}
		}
	}
	if len(apps) == 0 {
		return
	}

	for i := range snap.HTTPRouters {
		r := &snap.HTTPRouters[i]
		var guards []*model.Middleware
		for _, name := range r.Middlewares {
			if m, ok := mws[mwKey{r.Instance, name}]; ok && m.Authentik != nil {
				guards = append(guards, m)
			}
		}
		if len(guards) == 0 || s.authentik == nil {
			continue
		}
		a, ok := s.authentik.Lookup(r.Host)
		if !ok {
			continue
		}
		r.Authentik = &model.AuthentikInfo{
			Application: a.Application,
			Slug:        a.Slug,
			Provider:    a.Provider,
			Outpost:     a.Outpost,
			Mode:        a.Mode,
		}
		display := a.Application
		if display == "" {
			display = a.Provider
		}
		for _, m := range guards {
			if display != "" {
				apps[m][display] = true
			}
			if a.Outpost != "" {
				outposts[m][a.Outpost] = true
			}
		}
	}

	// Sorted, deduped lists keep the snapshot hash deterministic.
	for m, set := range apps {
		m.Authentik.Applications = sortedKeys(set)
		m.Authentik.Outposts = sortedKeys(outposts[m])
	}
}

// isAuthentikMiddleware reports whether m is a forward-auth middleware
// pointing at an authentik outpost.
func isAuthentikMiddleware(m *model.Middleware) bool {
	if !strings.EqualFold(m.Type, "forwardauth") {
		return false
	}
	addr, _ := m.Config["address"].(string)
	return strings.Contains(addr, authentikSignature)
}

func sortedKeys(set map[string]bool) []string {
	if len(set) == 0 {
		return nil
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
