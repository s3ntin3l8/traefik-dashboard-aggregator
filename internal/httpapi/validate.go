package httpapi

import (
	"regexp"
	"time"
)

// instanceNameRe is the allowlist for the optional ?instance= filter. It is
// deliberately narrow: instance names are config-defined node identifiers
// (e.g. "gateway", "node-01", "10.0.0.1"), never free-form LogQL. Anything
// outside this set is rejected so it can never reach the Loki selector.
var instanceNameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

func validInstanceName(s string) bool { return instanceNameRe.MatchString(s) }

// clampWindow ensures start <= end and the span does not exceed max, bounding
// how much history a single Loki query can pull.
func clampWindow(start, end time.Time, max time.Duration) (time.Time, time.Time) {
	if start.After(end) {
		start = end
	}
	if end.Sub(start) > max {
		start = end.Add(-max)
	}
	return start, end
}

// advanceSince returns the next tail cursor: it only moves forward on a
// successful poll, so a transient Loki error doesn't skip the window's lines.
func advanceSince(prev, now time.Time, err error) time.Time {
	if err != nil {
		return prev
	}
	return now
}
