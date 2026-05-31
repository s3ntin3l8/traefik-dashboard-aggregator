// Package httpx holds small HTTP client helpers shared by the Loki and Traefik
// clients, both of which send basic-auth credentials to a fixed upstream.
package httpx

import (
	"fmt"
	"net/http"
)

// maxRedirects bounds redirect chains to avoid loops.
const maxRedirects = 10

// NoCrossHostRedirect is an http.Client.CheckRedirect policy that refuses to
// follow a redirect to a different host. These clients talk to one configured
// upstream and carry credentials; a cross-host redirect could otherwise replay
// the Authorization header to an attacker-chosen destination (see GO-2025-3420).
func NoCrossHostRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return fmt.Errorf("stopped after %d redirects", maxRedirects)
	}
	if len(via) > 0 && req.URL.Host != via[0].URL.Host {
		return fmt.Errorf("refusing cross-host redirect to %q", req.URL.Host)
	}
	return nil
}
