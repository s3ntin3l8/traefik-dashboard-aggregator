package loki

import (
	"testing"
)

func TestParseNanoToMs(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"1700000000000000000", 1700000000000},
		{"0", 0},
		{"abc", -1}, // sentinel: we check it's > 0 (real result uses time.Now())
	}
	for _, c := range cases {
		got := parseNanoToMs(c.in)
		if c.want >= 0 && got != c.want {
			t.Errorf("parseNanoToMs(%q) = %d, want %d", c.in, got, c.want)
		}
		if c.want < 0 && got <= 0 {
			t.Errorf("parseNanoToMs(%q) = %d, want >0 (time.Now fallback)", c.in, got)
		}
	}
}

func TestFirstLabel(t *testing.T) {
	labels := map[string]string{"instance": "gw1", "host": "10.0.0.1"}
	cases := []struct {
		keys []string
		want string
	}{
		{[]string{"instance", "node"}, "gw1"},
		{[]string{"node", "host"}, "10.0.0.1"},
		{[]string{"missing"}, ""},
		{[]string{"instance", "host"}, "gw1"}, // first match wins
	}
	for _, c := range cases {
		if got := firstLabel(labels, c.keys...); got != c.want {
			t.Errorf("firstLabel(%v) = %q, want %q", c.keys, got, c.want)
		}
	}
}

func TestStr(t *testing.T) {
	if got := str("hello"); got != "hello" {
		t.Errorf("str(string) = %q, want %q", got, "hello")
	}
	if got := str(float64(3.14)); got != "3.14" {
		t.Errorf("str(float64) = %q, want %q", got, "3.14")
	}
	if got := str(nil); got != "" {
		t.Errorf("str(nil) = %q, want empty", got)
	}
	if got := str(42); got != "" {
		t.Errorf("str(int) = %q, want empty", got)
	}
}

func TestNum(t *testing.T) {
	if got := num(float64(200)); got != 200 {
		t.Errorf("num(float64) = %d, want 200", got)
	}
	if got := num("404"); got != 404 {
		t.Errorf("num(string) = %d, want 404", got)
	}
	if got := num(nil); got != 0 {
		t.Errorf("num(nil) = %d, want 0", got)
	}
}

func TestDurationMs(t *testing.T) {
	if got := durationMs(float64(5_000_000)); got != 5 {
		t.Errorf("durationMs(nanos) = %d, want 5", got)
	}
	if got := durationMs("1.5s"); got != 1500 {
		t.Errorf("durationMs(string) = %d, want 1500", got)
	}
	if got := durationMs("invalid"); got != 0 {
		t.Errorf("durationMs(invalid) = %d, want 0", got)
	}
	if got := durationMs(nil); got != 0 {
		t.Errorf("durationMs(nil) = %d, want 0", got)
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		addr, host, want string
	}{
		{"10.0.0.1:43210", "192.168.1.1", "192.168.1.1"},
		{"10.0.0.1:43210", "", "10.0.0.1"},
		{"10.0.0.1", "", "10.0.0.1"},
		{"", "", ""},
		{"[::1]:443", "", "[::1]"},
	}
	for _, c := range cases {
		if got := clientIP(c.addr, c.host); got != c.want {
			t.Errorf("clientIP(%q, %q) = %q, want %q", c.addr, c.host, got, c.want)
		}
	}
}

func TestNormLevel(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"warn", "warning"},
		{"warning", "warning"},
		{"WARN", "warning"},
		{"err", "error"},
		{"error", "error"},
		{"fatal", "error"},
		{"panic", "error"},
		{"info", "info"},
		{"DEBUG", "info"},
		{"", "info"},
	}
	for _, c := range cases {
		if got := normLevel(c.in); got != c.want {
			t.Errorf("normLevel(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestGuessLevel(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"something errored out", "error"},
		{"connection failed", "error"},
		{"this is a warning", "warning"},
		{"all is well", "info"},
		{"ERROR: big problem", "error"},
	}
	for _, c := range cases {
		if got := guessLevel(c.in); got != c.want {
			t.Errorf("guessLevel(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestShortName(t *testing.T) {
	if got := shortName("svc@docker"); got != "svc" {
		t.Errorf("shortName(svc@docker) = %q, want %q", got, "svc")
	}
	if got := shortName("svc"); got != "svc" {
		t.Errorf("shortName(svc) = %q, want %q", got, "svc")
	}
}

func TestShortHash(t *testing.T) {
	h1 := shortHash("hello")
	h2 := shortHash("hello")
	if h1 != h2 {
		t.Errorf("shortHash not deterministic: %q != %q", h1, h2)
	}
	h3 := shortHash("world")
	if h1 == h3 {
		t.Error("shortHash collision for different inputs")
	}
}

func TestNormalize_AccessLog(t *testing.T) {
	line := `{"level":"info","RequestMethod":"GET","RequestPath":"/api","RequestHost":"example.com","RequestProtocol":"HTTP/1.1","RouterName":"myrouter","ServiceName":"myservice@docker","DownstreamStatus":200,"DownstreamContentSize":1234,"ClientAddr":"10.0.0.1:43210","Duration":5000000}`
	labels := map[string]string{"instance": "gw1"}

	e := normalize("1700000000000000000", line, labels)

	if e.Kind != "access" {
		t.Errorf("kind = %q, want access", e.Kind)
	}
	if e.Method != "GET" {
		t.Errorf("method = %q, want GET", e.Method)
	}
	if e.Status != 200 {
		t.Errorf("status = %d, want 200", e.Status)
	}
	if e.Level != "info" {
		t.Errorf("level = %q, want info (200 response)", e.Level)
	}
	if e.Router != "myrouter" {
		t.Errorf("router = %q, want myrouter", e.Router)
	}
	if e.Service != "myservice@docker" {
		t.Errorf("service = %q, want myservice@docker", e.Service)
	}
	if e.App != "myservice" {
		t.Errorf("app = %q, want myservice (shortName fallback)", e.App)
	}
	if e.ClientIP != "10.0.0.1" {
		t.Errorf("clientIP = %q, want 10.0.0.1", e.ClientIP)
	}
	if e.Instance != "gw1" {
		t.Errorf("instance = %q, want gw1", e.Instance)
	}
	if e.DurationMs != 5 {
		t.Errorf("durationMs = %d, want 5", e.DurationMs)
	}
}

func TestNormalize_AccessLog4xx(t *testing.T) {
	line := `{"RequestMethod":"GET","DownstreamStatus":404,"DownstreamContentSize":0,"Duration":1000000}`
	e := normalize("1700000000000000000", line, nil)
	if e.Level != "warning" {
		t.Errorf("4xx level = %q, want warning", e.Level)
	}
}

func TestNormalize_AccessLog5xx(t *testing.T) {
	line := `{"RequestMethod":"GET","DownstreamStatus":503,"DownstreamContentSize":0,"Duration":1000000}`
	e := normalize("1700000000000000000", line, nil)
	if e.Level != "error" {
		t.Errorf("5xx level = %q, want error", e.Level)
	}
}

func TestNormalize_AppLog(t *testing.T) {
	line := `{"level":"error","msg":"connection refused","time":"2024-01-01T00:00:00Z"}`
	labels := map[string]string{"app": "traefik"}

	e := normalize("1700000000000000000", line, labels)

	if e.Kind != "system" {
		t.Errorf("kind = %q, want system", e.Kind)
	}
	if e.Level != "error" {
		t.Errorf("level = %q, want error", e.Level)
	}
	if e.Msg != "connection refused" {
		t.Errorf("msg = %q, want 'connection refused'", e.Msg)
	}
	if e.App != "traefik" {
		t.Errorf("app = %q, want traefik", e.App)
	}
}

func TestNormalize_AppLogExtraFields(t *testing.T) {
	line := `{"level":"info","msg":"started","time":"2024-01-01T00:00:00Z","module":"acme","attempt":3}`
	e := normalize("1700000000000000000", line, nil)
	if e.Msg != "started" {
		t.Errorf("msg = %q, want started", e.Msg)
	}
	if e.Fields["module"] != "acme" {
		t.Errorf("fields[module] = %v, want acme", e.Fields["module"])
	}
}

func TestNormalize_PlainText(t *testing.T) {
	line := "something failed unexpectedly"
	e := normalize("1700000000000000000", line, nil)
	if e.Kind != "system" {
		t.Errorf("kind = %q, want system", e.Kind)
	}
	if e.Msg != line {
		t.Errorf("msg = %q, want %q", e.Msg, line)
	}
	if e.Level != "error" {
		t.Errorf("level = %q, want error (contains 'fail')", e.Level)
	}
}

func TestNormalize_MessageFieldFallback(t *testing.T) {
	line := `{"level":"debug","message":"hello from message field"}`
	e := normalize("1700000000000000000", line, nil)
	if e.Msg != "hello from message field" {
		t.Errorf("msg = %q, want fallback to 'message' field", e.Msg)
	}
}
