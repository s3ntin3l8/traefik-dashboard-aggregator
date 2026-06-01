package traefik

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/s3ntin3l8/traefik-dashboard-aggregator/internal/model"
)

// Raw Traefik REST API response shapes (v3). Only fields we use are mapped.

type rawRouter struct {
	EntryPoints []string       `json:"entryPoints"`
	Service     string         `json:"service"`
	Rule        string         `json:"rule"`
	Priority    int            `json:"priority"`
	Middlewares []string       `json:"middlewares"`
	TLS         map[string]any `json:"tls"`
	Status      string         `json:"status"`
	Error       []string       `json:"error"`
	Name        string         `json:"name"`
	Provider    string         `json:"provider"`
}

type rawService struct {
	LoadBalancer *struct {
		Servers []struct {
			URL     string `json:"url"`
			Address string `json:"address"`
		} `json:"servers"`
	} `json:"loadBalancer"`
	Status       string            `json:"status"`
	UsedBy       []string          `json:"usedBy"`
	ServerStatus map[string]string `json:"serverStatus"`
	Name         string            `json:"name"`
	Provider     string            `json:"provider"`
	Type         string            `json:"type"`
}

// rawMiddleware keeps the raw object so we can pull the type-named config block.
type rawMiddleware map[string]any

type rawCertificate struct {
	Name       string   `json:"name"`
	SANs       []string `json:"sans"`
	NotAfter   string   `json:"notAfter"`
	NotBefore  string   `json:"notBefore"`
	Serial     string   `json:"serialNumber"`
	CommonName string   `json:"commonName"`
	IssuerOrg  string   `json:"issuerOrg"`
	IssuerCN   string   `json:"issuerCN"`
	KeyType    string   `json:"keyType"`
	KeySize    int      `json:"keySize"`
	Status     string   `json:"status"`
	Resolver   string   `json:"resolver"`
}

type rawEntryPoint struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type rawVersion struct {
	Version  string `json:"Version"`
	Codename string `json:"Codename"`
}

var hostRuleRe = regexp.MustCompile("Host(?:SNI)?\\(`([^`]+)`")

// shortName strips the @provider suffix ("app@docker" -> "app").
func shortName(name string) string {
	if i := strings.IndexByte(name, '@'); i >= 0 {
		return name[:i]
	}
	return name
}

// providerOf returns the provider portion of "name@provider", falling back to
// the explicit provider field.
func providerOf(name, fallback string) string {
	if i := strings.IndexByte(name, '@'); i >= 0 {
		return name[i+1:]
	}
	return fallback
}

// hostFromRule extracts the first Host(`...`) / HostSNI(`...`) value.
func hostFromRule(rule string) string {
	if m := hostRuleRe.FindStringSubmatch(rule); m != nil {
		return m[1]
	}
	return ""
}

// serviceStatusFromServers derives ok/degraded/down from a serverStatus map.
func serviceStatusFromServers(serverStatus map[string]string) (status string, up, total int) {
	total = len(serverStatus)
	for _, s := range serverStatus {
		if strings.EqualFold(s, "UP") {
			up++
		}
	}
	switch {
	case total == 0:
		return "ok", 0, 0 // no health info; treat as ok
	case up == 0:
		return "down", up, total
	case up < total:
		return "degraded", up, total
	default:
		return "ok", up, total
	}
}

// toServers builds the model server list, merging definition + health.
func toServers(raw *rawService) []model.Server {
	out := []model.Server{}
	if raw.LoadBalancer == nil {
		return out
	}
	for _, s := range raw.LoadBalancer.Servers {
		addr := s.URL
		if addr == "" {
			addr = s.Address
		}
		st := "UP"
		if v, ok := raw.ServerStatus[addr]; ok {
			st = v
		}
		out = append(out, model.Server{URL: s.URL, Address: s.Address, Status: st})
	}
	return out
}

func parseTimeMs(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

// middlewareConfig pulls the config block keyed by the middleware's type.
func middlewareConfig(raw rawMiddleware, mwType string) map[string]any {
	if mwType == "" {
		return map[string]any{}
	}
	if cfg, ok := raw[mwType].(map[string]any); ok {
		return cfg
	}
	// Traefik reports the type in lower case (e.g. "redirectscheme") while the
	// config block is keyed by the original camelCase name (e.g.
	// "redirectScheme"), so fall back to a case-insensitive match.
	for k, v := range raw {
		if strings.EqualFold(k, mwType) {
			if cfg, ok := v.(map[string]any); ok {
				return cfg
			}
		}
	}
	return map[string]any{}
}

func keySizeSuffix(keyType string, keySize int) string {
	if keySize > 0 {
		return keyType + " " + strconv.Itoa(keySize)
	}
	return keyType
}
