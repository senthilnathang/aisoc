package telemetrypipeline

import (
	"fmt"
	"strconv"
	"testing"
)

type loadConfig struct{ events, eps, pauseSeconds, idlePollMS, burstMultiplier int }

func parseLoadConfig(getenv func(string) string) (loadConfig, error) {
	c := loadConfig{events: 1000, eps: 1000, idlePollMS: 1, burstMultiplier: 1}
	if raw := getenv("AISOC_STREAM_LOAD_BURST_MULTIPLIER"); raw != "" {
		var err error
		c.burstMultiplier, err = strconv.Atoi(raw)
		if err != nil || c.burstMultiplier < 1 || c.burstMultiplier > 5 {
			return c, fmt.Errorf("invalid burst multiplier")
		}
	}
	for name, target := range map[string]*int{"AISOC_STREAM_LOAD_EVENTS": &c.events, "AISOC_STREAM_LOAD_EPS": &c.eps, "AISOC_STREAM_LOAD_PAUSE_SECONDS": &c.pauseSeconds, "AISOC_STREAM_LOAD_IDLE_POLL_MS": &c.idlePollMS} {
		if raw := getenv(name); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				return c, fmt.Errorf("invalid %s", name)
			}
			*target = n
		}
	}
	if c.events < 100 || c.events > 10000 || c.events%100 != 0 || c.eps < 100 || c.eps > 1000 || c.pauseSeconds < 0 || c.pauseSeconds > 10 || c.idlePollMS < 1 || c.idlePollMS > 100 {
		return c, fmt.Errorf("workload exceeds bounded test limits")
	}
	return c, nil
}

func TestLoadConfigBounds(t *testing.T) {
	for _, tc := range []struct {
		values map[string]string
		valid  bool
	}{
		{nil, true},
		{map[string]string{"AISOC_STREAM_LOAD_IDLE_POLL_MS": "20"}, true},
		{map[string]string{"AISOC_STREAM_LOAD_IDLE_POLL_MS": "0"}, false},
		{map[string]string{"AISOC_STREAM_LOAD_IDLE_POLL_MS": "101"}, false},
		{map[string]string{"AISOC_STREAM_LOAD_EVENTS": "3000", "AISOC_STREAM_LOAD_EPS": "100", "AISOC_STREAM_LOAD_PAUSE_SECONDS": "2"}, true},
		{map[string]string{"AISOC_STREAM_LOAD_EVENTS": "101"}, false},
		{map[string]string{"AISOC_STREAM_LOAD_EVENTS": "10001"}, false},
		{map[string]string{"AISOC_STREAM_LOAD_EPS": "0"}, false},
		{map[string]string{"AISOC_STREAM_LOAD_PAUSE_SECONDS": "11"}, false},
		{map[string]string{"AISOC_STREAM_LOAD_EPS": "bad"}, false},
	} {
		_, err := parseLoadConfig(func(k string) string { return tc.values[k] })
		if (err == nil) != tc.valid {
			t.Fatalf("%v: %v", tc.values, err)
		}
	}
}
