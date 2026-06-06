// Package model defines the aggregated snapshot that the backend serves to the
// SPA. JSON field names intentionally match the design prototype's
// window.TV.buildSnapshot() shape so the React components bind unchanged.
//
// All timestamps are Unix milliseconds (to match the prototype's Date.now()).
package model

// Snapshot is the full aggregated state across all configured instances.
type Snapshot struct {
	GeneratedAt    int64         `json:"generatedAt"`
	Domain         string        `json:"domain"`
	Instances      []Instance    `json:"instances"`
	EntryPoints    []string      `json:"entryPoints"`
	HTTPRouters    []Router      `json:"httpRouters"`
	HTTPServices   []Service     `json:"httpServices"`
	Middlewares    []Middleware  `json:"middlewares"`
	TCPRouters     []Router      `json:"tcpRouters"`
	TCPServices    []Service     `json:"tcpServices"`
	TCPMiddlewares []Middleware  `json:"tcpMiddlewares"`
	UDPRouters     []Router      `json:"udpRouters"`
	UDPServices    []Service     `json:"udpServices"`
	Certificates   []Certificate `json:"certificates"`
}

// Instance is one downstream Traefik node's health/summary.
type Instance struct {
	Name         string         `json:"name"`
	Role         string         `json:"role,omitempty"` // "gateway" | "" (node)
	URL          string         `json:"url"`
	IP           string         `json:"ip"`
	DashboardURL string         `json:"dashboardURL"`
	Status       string         `json:"status"` // ok | degraded | unreachable
	Version      string         `json:"version"`
	LastScrape   int64          `json:"lastScrape"`
	ScrapeMs     *int64         `json:"scrapeMs"`
	Error        string         `json:"error,omitempty"`
	Counts       InstanceCounts `json:"counts"`
}

// InstanceCounts are the per-node tallies shown on the instance cards.
type InstanceCounts struct {
	Routers     int `json:"routers"`
	Services    int `json:"services"`
	Middlewares int `json:"middlewares"`
	Warnings    int `json:"warnings"`
}

// Router is an HTTP/TCP/UDP router (UDP omits rule/tls/middlewares).
type Router struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	ShortName     string   `json:"shortName"`
	Rule          string   `json:"rule,omitempty"`
	Host          string   `json:"host,omitempty"`
	Service       string   `json:"service"`
	ServiceStatus string   `json:"serviceStatus,omitempty"` // ok | degraded | down
	Middlewares   []string `json:"middlewares"`
	EntryPoints   []string `json:"entryPoints"`
	TLS           bool     `json:"tls"`
	CertResolver  string   `json:"certResolver,omitempty"`
	Provider      string   `json:"provider"`
	Instance      string   `json:"instance"`
	Status        string   `json:"status"` // enabled | warning | error | disabled
	Errors        []string `json:"errors,omitempty"`
	Priority      int      `json:"priority,omitempty"`
	URL           string   `json:"url,omitempty"`
	// Authentik is set when the router is guarded by an authentik forward-auth
	// middleware and its host matched an authentik proxy provider.
	Authentik *AuthentikInfo `json:"authentik,omitempty"`
}

// AuthentikInfo is the authentik application guarding a router, resolved by
// matching the router's host against the provider's external_host or
// cookie_domain (the middleware only identifies the outpost endpoint).
type AuthentikInfo struct {
	Application string `json:"application,omitempty"` // may be empty (unbound provider)
	Slug        string `json:"slug,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Outpost     string `json:"outpost,omitempty"`
	Mode        string `json:"mode,omitempty"` // forward_single | forward_domain
}

// Server is one backend behind a service.
type Server struct {
	URL     string `json:"url,omitempty"`
	Address string `json:"address,omitempty"`
	Status  string `json:"status"` // UP | DOWN
}

// Service is an HTTP/TCP/UDP service with backend health.
type Service struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ShortName    string   `json:"shortName"`
	Provider     string   `json:"provider"`
	Type         string   `json:"type"`
	Instance     string   `json:"instance"`
	Servers      []Server `json:"servers"`
	ServersUp    int      `json:"serversUp"`
	ServersTotal int      `json:"serversTotal"`
	Status       string   `json:"status"` // ok | degraded | down
	UsedBy       []string `json:"usedBy"`
}

// Middleware is an HTTP/TCP middleware with usage and raw config.
type Middleware struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	FullName      string         `json:"fullName"`
	Type          string         `json:"type"`
	Provider      string         `json:"provider"`
	Instance      string         `json:"instance"`
	Config        map[string]any `json:"config"`
	UsedBy        int            `json:"usedBy"`
	UsedByRouters []string       `json:"usedByRouters"`
	Error         []string       `json:"error,omitempty"`
	// Authentik marks an authentik forward-auth middleware. A shared middleware
	// serves many routers/hosts, so it aggregates the distinct apps/outposts
	// reached through it rather than naming a single application.
	Authentik *MiddlewareAuthentik `json:"authentik,omitempty"`
}

// MiddlewareAuthentik aggregates the authentik apps reached via one
// forward-auth middleware. Both lists may be empty when no router using the
// middleware matched (or enrichment is disabled) — the marker alone still
// identifies the middleware as authentik.
type MiddlewareAuthentik struct {
	Applications []string `json:"applications,omitempty"`
	Outposts     []string `json:"outposts,omitempty"`
}

// Certificate is one TLS certificate from a node's /api/certificates.
type Certificate struct {
	ID        string   `json:"id"`
	Domain    string   `json:"domain"`
	Wildcard  bool     `json:"wildcard"`
	SANs      []string `json:"sans"`
	Resolver  string   `json:"resolver"`
	Issuer    string   `json:"issuer"`
	IssuerCN  string   `json:"issuerCN"`
	Serial    string   `json:"serial"`
	KeyType   string   `json:"keyType"`
	NotBefore int64    `json:"notBefore"`
	NotAfter  int64    `json:"notAfter"`
	Instance  string   `json:"instance"`
	Status    string   `json:"status"`
}
