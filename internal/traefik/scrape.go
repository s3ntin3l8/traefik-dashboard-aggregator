package traefik

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
)

// InstanceResult is one node's contribution to the aggregate snapshot.
type InstanceResult struct {
	Name           string
	Version        string
	EntryPoints    []string
	HTTPRouters    []model.Router
	HTTPServices   []model.Service
	Middlewares    []model.Middleware
	TCPRouters     []model.Router
	TCPServices    []model.Service
	TCPMiddlewares []model.Middleware
	UDPRouters     []model.Router
	UDPServices    []model.Service
	Certificates   []model.Certificate
	// Degraded is true when reachable but some backend servers are DOWN.
	Degraded bool
	// Err is non-nil when the scrape failed (node unreachable).
	Err error
}

// Scrape concurrently fetches every endpoint for one instance and transforms
// the responses into model entities, instance-tagging each row.
func (c *Client) Scrape(ctx context.Context) InstanceResult {
	res := InstanceResult{Name: c.name}

	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		errs []error
	)
	fail := func(err error) {
		mu.Lock()
		errs = append(errs, err)
		mu.Unlock()
	}
	// optional: a 404 means "endpoint absent on this version" -> ignore.
	run := func(fn func() error, optional bool) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fn(); err != nil {
				if optional && errors.As(err, &errNotFound{}) {
					return
				}
				fail(err)
			}
		}()
	}

	run(func() error {
		var v rawVersion
		if err := c.getJSON(ctx, "/version", &v); err != nil {
			return err
		}
		res.Version = strings.TrimPrefix(v.Version, "v")
		return nil
	}, false)

	run(func() error {
		var raw []rawEntryPoint
		if err := c.getJSON(ctx, "/entrypoints", &raw); err != nil {
			return err
		}
		eps := make([]string, 0, len(raw))
		for _, e := range raw {
			eps = append(eps, e.Name)
		}
		sort.Strings(eps)
		res.EntryPoints = eps
		return nil
	}, true)

	run(func() error {
		rr, err := c.routers(ctx, "/http/routers")
		if err == nil {
			res.HTTPRouters = rr
		}
		return err
	}, false)
	run(func() error {
		sv, degraded, err := c.services(ctx, "/http/services")
		if err == nil {
			res.HTTPServices = sv
			if degraded {
				res.Degraded = true
			}
		}
		return err
	}, false)
	run(func() error {
		mw, err := c.middlewares(ctx, "/http/middlewares")
		if err == nil {
			res.Middlewares = mw
		}
		return err
	}, false)

	run(func() error {
		rr, err := c.routers(ctx, "/tcp/routers")
		if err == nil {
			res.TCPRouters = rr
		}
		return err
	}, true)
	run(func() error {
		sv, _, err := c.services(ctx, "/tcp/services")
		if err == nil {
			res.TCPServices = sv
		}
		return err
	}, true)
	run(func() error {
		mw, err := c.middlewares(ctx, "/tcp/middlewares")
		if err == nil {
			res.TCPMiddlewares = mw
		}
		return err
	}, true)
	run(func() error {
		rr, err := c.routers(ctx, "/udp/routers")
		if err == nil {
			res.UDPRouters = rr
		}
		return err
	}, true)
	run(func() error {
		sv, _, err := c.services(ctx, "/udp/services")
		if err == nil {
			res.UDPServices = sv
		}
		return err
	}, true)

	run(func() error {
		certs, err := c.certificates(ctx)
		if err == nil {
			res.Certificates = certs
		}
		return err
	}, true)

	wg.Wait()
	if len(errs) > 0 {
		res.Err = errors.Join(errs...)
		return res
	}

	// Cross-link router -> service health (separate endpoints) and reflect it
	// in the router's displayed status (matches the design's vocabulary).
	linkRouterServiceStatus(res.HTTPRouters, res.HTTPServices)
	linkRouterServiceStatus(res.TCPRouters, res.TCPServices)

	// Flag routers whose certResolver is set but no certificate covers their
	// host. Skip the check when the instance has no certs at all (fresh node)
	// to avoid false positives.
	linkRouterTLSCoverage(res.HTTPRouters, res.Certificates)
	linkRouterTLSCoverage(res.TCPRouters, res.Certificates)
	return res
}

// linkRouterServiceStatus sets each router's serviceStatus from its service and
// downgrades router status to warning/error when backends are unhealthy.
func linkRouterServiceStatus(routers []model.Router, services []model.Service) {
	byName := make(map[string]string, len(services))
	for _, s := range services {
		byName[s.Name] = s.Status
	}
	for i := range routers {
		st, ok := byName[routers[i].Service]
		if !ok {
			continue
		}
		routers[i].ServiceStatus = st
		switch st {
		case "down":
			if routers[i].Status == "enabled" {
				routers[i].Status = "error"
			}
		case "degraded":
			if routers[i].Status == "enabled" {
				routers[i].Status = "warning"
			}
		}
	}
}

// linkRouterTLSCoverage flags routers that want automatic cert management
// (certResolver set) but have no certificate covering their host. Skipped
// when the instance has no certs at all (fresh node) to avoid false positives.
// Wildcard certs (*.example.test) are matched against subdomains.
func linkRouterTLSCoverage(routers []model.Router, certs []model.Certificate) {
	if len(certs) == 0 {
		return
	}
	covered := make(map[string]bool, len(certs)*2)
	for _, c := range certs {
		covered[strings.ToLower(c.Domain)] = true
		for _, san := range c.SANs {
			covered[strings.ToLower(san)] = true
		}
	}
	for i := range routers {
		if routers[i].CertResolver == "" || routers[i].Host == "" {
			continue
		}
		host := strings.ToLower(routers[i].Host)
		if covered[host] || covered[wildcardDomain(host)] {
			continue
		}
		if routers[i].Status == "enabled" {
			routers[i].Status = "warning"
		}
		routers[i].Errors = append(routers[i].Errors,
			"no TLS certificate covering "+routers[i].Host+" (certResolver: "+routers[i].CertResolver+")")
	}
}

// wildcardDomain returns the wildcard form of a hostname so that
// "aerie.example.test" can be matched against a "*.example.test" cert SAN.
func wildcardDomain(host string) string {
	if i := strings.IndexByte(host, '.'); i >= 0 {
		return "*" + host[i:]
	}
	return ""
}

func (c *Client) routers(ctx context.Context, path string) ([]model.Router, error) {
	var raw []rawRouter
	if err := c.getJSON(ctx, path, &raw); err != nil {
		return nil, err
	}
	out := make([]model.Router, 0, len(raw))
	for _, r := range raw {
		mws := r.Middlewares
		if mws == nil {
			mws = []string{}
		}
		eps := r.EntryPoints
		if eps == nil {
			eps = []string{}
		}
		host := hostFromRule(r.Rule)
		url := ""
		resolver := ""
		if r.TLS != nil {
			if v, ok := r.TLS["certResolver"].(string); ok {
				resolver = v
			}
			if host != "" {
				url = "https://" + host
			}
		} else if host != "" {
			url = "http://" + host
		}
		status := r.Status
		if status == "enabled" && len(r.Error) > 0 {
			status = "warning"
		}
		out = append(out, model.Router{
			ID:           c.name + ":" + r.Name,
			Name:         r.Name,
			ShortName:    shortName(r.Name),
			Rule:         r.Rule,
			Host:         host,
			Service:      r.Service,
			Middlewares:  mws,
			EntryPoints:  eps,
			TLS:          r.TLS != nil,
			CertResolver: resolver,
			Provider:     providerOf(r.Name, r.Provider),
			Instance:     c.name,
			Status:       status,
			Errors:       r.Error,
			Priority:     r.Priority,
			URL:          url,
		})
	}
	return out, nil
}

func (c *Client) services(ctx context.Context, path string) ([]model.Service, bool, error) {
	var raw []rawService
	if err := c.getJSON(ctx, path, &raw); err != nil {
		return nil, false, err
	}
	out := make([]model.Service, 0, len(raw))
	anyDegraded := false
	for i := range raw {
		s := raw[i]
		status, up, total := serviceStatusFromServers(s.ServerStatus)
		if status == "down" || status == "degraded" {
			anyDegraded = true
		}
		usedBy := s.UsedBy
		if usedBy == nil {
			usedBy = []string{}
		}
		out = append(out, model.Service{
			ID:           c.name + ":" + s.Name,
			Name:         s.Name,
			ShortName:    shortName(s.Name),
			Provider:     providerOf(s.Name, s.Provider),
			Type:         serviceType(s.Type, providerOf(s.Name, s.Provider)),
			Instance:     c.name,
			Servers:      toServers(&s),
			ServersUp:    up,
			ServersTotal: total,
			Status:       status,
			UsedBy:       usedBy,
		})
	}
	return out, anyDegraded, nil
}

func (c *Client) middlewares(ctx context.Context, path string) ([]model.Middleware, error) {
	var raw []rawMiddleware
	if err := c.getJSON(ctx, path, &raw); err != nil {
		return nil, err
	}
	out := make([]model.Middleware, 0, len(raw))
	for _, m := range raw {
		name, _ := m["name"].(string)
		mwType, _ := m["type"].(string)
		usedBy := toStringSlice(m["usedBy"])
		var errList []string
		if e := toStringSlice(m["error"]); len(e) > 0 {
			errList = e
		}
		out = append(out, model.Middleware{
			ID:            c.name + ":" + name,
			Name:          shortName(name),
			FullName:      name,
			Type:          mwType,
			Provider:      providerOf(name, ""),
			Instance:      c.name,
			Config:        middlewareConfig(m, mwType),
			UsedBy:        len(usedBy),
			UsedByRouters: usedBy,
			Error:         errList,
		})
	}
	return out, nil
}

func (c *Client) certificates(ctx context.Context) ([]model.Certificate, error) {
	var raw []rawCertificate
	if err := c.getJSON(ctx, "/certificates", &raw); err != nil {
		return nil, err
	}
	out := make([]model.Certificate, 0, len(raw))
	for _, cert := range raw {
		domain := cert.CommonName
		if domain == "" && len(cert.SANs) > 0 {
			domain = cert.SANs[0]
		}
		sans := cert.SANs
		if sans == nil {
			sans = []string{}
		}
		out = append(out, model.Certificate{
			ID:        c.name + ":" + domain,
			Domain:    domain,
			Wildcard:  strings.HasPrefix(domain, "*"),
			SANs:      sans,
			Resolver:  cert.Resolver,
			Issuer:    cert.IssuerOrg,
			IssuerCN:  cert.IssuerCN,
			Serial:    cert.Serial,
			KeyType:   keySizeSuffix(cert.KeyType, cert.KeySize),
			NotBefore: parseTimeMs(cert.NotBefore),
			NotAfter:  parseTimeMs(cert.NotAfter),
			Instance:  c.name,
			Status:    cert.Status,
		})
	}
	return out, nil
}

func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
