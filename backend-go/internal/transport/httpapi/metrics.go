package httpapi

import (
	"context"
	"net/http"
	"runtime"
	"time"
)

type measuredResponse struct {
	http.ResponseWriter
	status int
}

func (w *measuredResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *measuredResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *measuredResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// The API binds loopback. This endpoint exposes aggregate operational data only;
// deployment proxies must not publish it alongside the browser API.
func (a *API) metrics(w http.ResponseWriter, r *http.Request) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	statuses := map[string]uint64{}
	for i, label := range []string{"0xx", "1xx", "2xx", "3xx", "4xx", "5xx"} {
		statuses[label] = a.statuses[i].Load()
	}
	buckets := map[string]uint64{}
	for i, label := range []string{"1", "5", "20", "100", "500", "2000", "+Inf"} {
		buckets[label] = a.latency[i].Load()
	}
	result := map[string]any{"requests_total": a.requests.Load(), "responses_total": statuses, "request_duration_seconds_sum": float64(a.duration.Load()) / 1e9, "request_duration_ms_cumulative_buckets": buckets, "go_heap_bytes": memory.HeapAlloc, "go_goroutines": runtime.NumGoroutine()}
	if a.pool != nil {
		stat := a.pool.Stat()
		result["database_pool"] = map[string]any{"acquired": stat.AcquiredConns(), "idle": stat.IdleConns(), "maximum": stat.MaxConns(), "acquire_wait_seconds_total": stat.EmptyAcquireWaitTime().Seconds(), "cancelled_acquires_total": stat.CanceledAcquireCount()}
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		var queued, failed int64
		var oldest float64
		err := a.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status IN ('queued','running')),count(*) FILTER (WHERE status='failed'),COALESCE(EXTRACT(EPOCH FROM now()-min(created_at) FILTER (WHERE status IN ('queued','running'))),0)::float8 FROM investigation_jobs`).Scan(&queued, &failed, &oldest)
		if err != nil {
			write(w, 503, map[string]any{"status": "metrics_unavailable"})
			return
		}
		result["investigation_jobs"] = map[string]any{"active": queued, "failed": failed, "oldest_active_seconds": oldest}
	}
	write(w, 200, result)
}
