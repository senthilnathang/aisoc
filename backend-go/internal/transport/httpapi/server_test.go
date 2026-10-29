package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
)

func TestReadinessAndNoDomainFallback(t *testing.T) {
	handler := New(func(context.Context) error { return errors.New("private database information") }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, item := range []struct {
		path   string
		status int
	}{{"/health", 200}, {"/ready", 503}, {"/api/v1/investigations", 404}} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", item.path, nil))
		if w.Code != item.status {
			t.Fatalf("%s status %d", item.path, w.Code)
		}
		if w.Header().Get("X-Request-ID") == "" {
			t.Fatal("missing request identity")
		}
	}
}

func TestOperationalMetricsCountErrorsWithoutRequestData(t *testing.T) {
	handler := New(func(context.Context) error { return errors.New("private database information") }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, path := range []string{"/health", "/ready", "/missing?credential=private"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	var metrics struct {
		Requests int            `json:"requests_total"`
		Statuses map[string]int `json:"responses_total"`
		Buckets  map[string]int `json:"request_duration_ms_cumulative_buckets"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &metrics); err != nil {
		t.Fatal(err)
	}
	if metrics.Requests != 4 || metrics.Statuses["2xx"] != 1 || metrics.Statuses["4xx"] != 1 || metrics.Statuses["5xx"] != 1 || metrics.Buckets["+Inf"] != 3 {
		t.Fatal(metrics)
	}
}
