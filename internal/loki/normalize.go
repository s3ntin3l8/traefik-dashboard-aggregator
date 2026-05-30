package loki

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// normalize converts a raw Loki value ([ts_ns, line]) + stream labels into a
// LogEntry. It understands Traefik JSON access logs and JSON app/system logs;
// anything else falls back to a plain system message.
func normalize(tsNano, line string, labels map[string]string) LogEntry {
	e := LogEntry{
		ID:       tsNano + "-" + shortHash(line),
		TS:       parseNanoToMs(tsNano),
		Kind:     "system",
		Level:    "info",
		Instance: firstLabel(labels, "instance", "node", "host", "nodename"),
		App:      firstLabel(labels, "app", "service_name", "container", "compose_service"),
	}

	var m map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &m); err != nil {
		e.Msg = line
		e.Level = guessLevel(line)
		return e
	}

	if lvl := str(m["level"]); lvl != "" {
		e.Level = normLevel(lvl)
	}
	if str(m["RouterName"]) != "" || m["RequestMethod"] != nil || m["DownstreamStatus"] != nil {
		e.Kind = "access"
		e.Method = str(m["RequestMethod"])
		e.Path = str(m["RequestPath"])
		e.Host = str(m["RequestHost"])
		e.Proto = str(m["RequestProtocol"])
		e.Router = str(m["RouterName"])
		e.Service = str(m["ServiceName"])
		e.Status = num(m["DownstreamStatus"])
		e.Size = num(m["DownstreamContentSize"])
		e.ClientIP = clientIP(str(m["ClientAddr"]), str(m["ClientHost"]))
		e.DurationMs = durationMs(m["Duration"])
		switch {
		case e.Status >= 500:
			e.Level = "error"
		case e.Status >= 400:
			e.Level = "warning"
		default:
			e.Level = "info"
		}
		if e.App == "" {
			e.App = shortName(e.Service)
		}
		return e
	}

	e.Msg = str(m["msg"])
	if e.Msg == "" {
		e.Msg = str(m["message"])
	}
	delete(m, "level")
	delete(m, "time")
	delete(m, "msg")
	delete(m, "message")
	if len(m) > 0 {
		e.Fields = m
	}
	return e
}

func parseNanoToMs(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return time.Now().UnixMilli()
	}
	return n / 1e6
}

func firstLabel(labels map[string]string, keys ...string) string {
	for _, k := range keys {
		if v, ok := labels[k]; ok && v != "" {
			return v
		}
	}
	return ""
}

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return ""
	}
}

func num(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case string:
		n, _ := strconv.Atoi(t)
		return n
	default:
		return 0
	}
}

// durationMs handles Traefik's Duration (nanoseconds number, or "1.2ms").
func durationMs(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t / 1e6)
	case string:
		if d, err := time.ParseDuration(t); err == nil {
			return int(d.Milliseconds())
		}
	}
	return 0
}

func clientIP(addr, host string) string {
	if host != "" {
		return host
	}
	if i := strings.LastIndexByte(addr, ':'); i >= 0 {
		return addr[:i]
	}
	return addr
}

func normLevel(l string) string {
	switch strings.ToLower(l) {
	case "warn", "warning":
		return "warning"
	case "err", "error", "fatal", "panic":
		return "error"
	default:
		return "info"
	}
}

func guessLevel(line string) string {
	low := strings.ToLower(line)
	switch {
	case strings.Contains(low, "error") || strings.Contains(low, "fail"):
		return "error"
	case strings.Contains(low, "warn"):
		return "warning"
	default:
		return "info"
	}
}

func shortName(name string) string {
	if i := strings.IndexByte(name, '@'); i >= 0 {
		return name[:i]
	}
	return name
}

func shortHash(s string) string {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return strconv.FormatUint(uint64(h), 16)
}
