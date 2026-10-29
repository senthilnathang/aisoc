package enrichment

import (
	"encoding/json"
	"math"
	"os"
	"sort"
	"testing"
	"time"
)

func TestCacheLoadReport(t *testing.T) {
	path := os.Getenv("AISOC_STREAM_LOAD_REPORT")
	if path == "" {
		t.Skip("opt-in measurement")
	}
	s, _, tenant := setup(t)
	add(t, s, tenant, "ioc", "192.0.2.10")
	lookup(t, s, tenant, "192.0.2.10")
	cached := []float64{}
	uncached := []float64{}
	measure := func(store Store, hit bool) float64 {
		t.Helper()
		start := time.Now()
		r := lookup(t, store, tenant, "192.0.2.10")
		if len(r.Matches) != 1 {
			t.Fatal(r)
		}
		if hit && r.CacheStatus != "hit" {
			t.Fatal("not a warm cache hit", r)
		}
		return float64(time.Since(start).Microseconds()) / 1000
	}
	for i := 0; i < 50; i++ {
		if i%2 == 0 {
			cached = append(cached, measure(s, true))
			uncached = append(uncached, measure(Store{Pool: s.Pool}, false))
		} else {
			uncached = append(uncached, measure(Store{Pool: s.Pool}, false))
			cached = append(cached, measure(s, true))
		}
	}
	quantiles := func(v []float64) map[string]float64 {
		sort.Float64s(v)
		p := func(x float64) float64 { return v[int(math.Ceil(x*float64(len(v))))-1] }
		return map[string]float64{"p50": p(.5), "p95": p(.95), "p99": p(.99)}
	}
	report := map[string]any{"samples_each": 50, "workload": "alternating warm-cache and uncached local exact IOC lookup; one tenant/indicator; both read PostgreSQL generation", "cached_ms": quantiles(cached), "uncached_ms": quantiles(uncached), "limits": "Small local microbenchmark; not external TI latency, contention, cold-cache behavior or production capacity. Existing processing remains uncached."}
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".cache.json", append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
