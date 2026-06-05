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
	for i := range snap.Middlewares {
		m := &snap.Middlewares[i]
		mws[mwKey{m.Instance, m.FullName}] = m
	}

	// targets[m] = the authentik forward-auth middlewares m resolves to:
	// itself, or — for chain middlewares — the authentik members reached
	// transitively. Routers often attach authentik via a chain (e.g.
	// strip-identity + forwardAuth, see docs/authentik.md), in which case the
	// router only references the chain.
	targets := map[*model.Middleware]map[*model.Middleware]bool{}
	for i := range snap.Middlewares {
		m := &snap.Middlewares[i]
		if isAuthentikMiddleware(m) {
			targets[m] = map[*model.Middleware]bool{m: true}
		}
	}
	if len(targets) == 0 {
		return
	}
	// Chains may nest; iterate to a fixpoint, depth-capped (cycle-safe: the
	// union only grows).
	for depth := 0; depth < 4; depth++ {
		changed := false
		for i := range snap.Middlewares {
			m := &snap.Middlewares[i]
			if !strings.EqualFold(m.Type, "chain") {
				continue
			}
			for _, name := range toStringList(m.Config["middlewares"]) {
				member, ok := mws[mwKey{m.Instance, name}]
				if !ok {
					// chain entries may omit the provider suffix
					member, ok = mws[mwKey{m.Instance, name + "@" + m.Provider}]
				}
				if !ok {
					continue
				}
				for t := range targets[member] {
					if !targets[m][t] {
						if targets[m] == nil {
							targets[m] = map[*model.Middleware]bool{}
						}
						targets[m][t] = true
						changed = true
					}
				}
			}
		}
		if !changed {
			break
		}
	}

	// Mark every authentik-guarding middleware (forward-auths and chains) and
	// prepare their aggregation sets. The bare marker alone drives the UI badge
	// even when no router/app match exists.
	apps := map[*model.Middleware]map[string]bool{}
	outposts := map[*model.Middleware]map[string]bool{}
	for m := range targets {
		m.Authentik = &model.MiddlewareAuthentik{}
		apps[m] = map[string]bool{}
		outposts[m] = map[string]bool{}
	}

	for i := range snap.HTTPRouters {
		r := &snap.HTTPRouters[i]
		// The marked middlewares this router is guarded through: each
		// referenced marked middleware plus the forward-auths it resolves to,
		// so a chain and its inner forwardAuth both aggregate the app.
		guards := map[*model.Middleware]bool{}
		for _, name := range r.Middlewares {
			m, ok := mws[mwKey{r.Instance, name}]
			if !ok || m.Authentik == nil {
				continue
			}
			guards[m] = true
			for t := range targets[m] {
				guards[t] = true
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
		for m := range guards {
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

// toStringList converts a decoded-JSON []any (or []string) to []string.
func toStringList(v any) []string {
	switch vv := v.(type) {
	case []string:
		return vv
	case []any:
		out := make([]string, 0, len(vv))
		for _, e := range vv {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
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
