package httpapi

import (
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/modules/response"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"
)

type API struct {
	ready    func(context.Context) error
	requests atomic.Uint64
	statuses [6]atomic.Uint64
	duration atomic.Uint64
	latency  [7]atomic.Uint64
	pool     *pgxpool.Pool
	log      *slog.Logger
}

func New(ready func(context.Context) error, log *slog.Logger) http.Handler {
	return build(ready, log, nil, nil)
}
func Application(ready func(context.Context) error, log *slog.Logger, c config.Auth, pool *pgxpool.Pool, connectorKey ...[]byte) http.Handler {
	return buildWithStreams(ready, log, auth.New(c), pool, c.StreamOperations, connectorKey...)
}
func build(ready func(context.Context) error, log *slog.Logger, security *auth.Manager, pool *pgxpool.Pool, connectorKey ...[]byte) http.Handler {
	return buildWithStreams(ready, log, security, pool, nil, connectorKey...)
}
func buildWithStreams(ready func(context.Context) error, log *slog.Logger, security *auth.Manager, pool *pgxpool.Pool, scopes []config.StreamScope, connectorKey ...[]byte) http.Handler {
	a := &API{ready: ready, log: log, pool: pool}
	mux := http.NewServeMux()
	if security != nil {
		security.SourceAuthenticate = (intake.Store{Pool: pool}).Authenticate
		security.Register(mux)
		registerPlans(mux, response.Store{Pool: pool})
		registerCases(mux, pool)
		registerQueue(mux, pool)
		registerDetection(mux, pool)
		registerIntelligence(mux, pool)
		registerThreatIntelligence(mux, pool)
		registerHunts(mux, pool)
		registerDashboard(mux, pool)
		registerSkills(mux, pool)
		var key []byte
		if len(connectorKey) > 0 {
			key = append([]byte(nil), connectorKey[0]...)
		}
		registerConnectors(mux, pool, key)
		registerSources(mux, pool)
		registerSourceMapping(mux, pool)
		registerIntake(mux, pool)
		registerStreamOperations(mux, pool, scopes)
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, map[string]any{"status": "ok", "database": "postgresql", "version": "0.1.0-framework"})
	})
	mux.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := a.ready(ctx); err != nil {
			write(w, 503, map[string]any{"status": "not_ready"})
			return
		}
		write(w, 200, map[string]any{"status": "ready"})
	})
	mux.HandleFunc("GET /metrics", a.metrics)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		write(w, 404, map[string]any{"error": map[string]any{"code": "NOT_FOUND", "message": "Endpoint is not implemented in the replacement backend", "details": nil}})
	})
	var handler http.Handler = mux
	if security != nil {
		handler = security.Protect(mux)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := &measuredResponse{ResponseWriter: w}
		w = response
		a.requests.Add(1)
		start := time.Now()
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			http.Error(w, "request initialization failed", 500)
			return
		}
		requestID := hex.EncodeToString(id)
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		r.Body = http.MaxBytesReader(w, r.Body, 1048576)
		defer func() {
			if recover() != nil {
				write(w, 500, map[string]any{"error": map[string]any{"code": "INTERNAL_ERROR", "message": "Internal server error", "details": nil}})
			}
			elapsed := time.Since(start)
			status := response.status
			if status == 0 {
				status = 200
			}
			if status/100 < len(a.statuses) {
				a.statuses[status/100].Add(1)
			}
			a.duration.Add(uint64(elapsed.Nanoseconds()))
			for i, limit := range []time.Duration{time.Millisecond, 5 * time.Millisecond, 20 * time.Millisecond, 100 * time.Millisecond, 500 * time.Millisecond, 2 * time.Second, time.Duration(1<<63 - 1)} {
				if elapsed <= limit {
					a.latency[i].Add(1)
				}
			}
			// Do not log arbitrary URLs, credentials, tenant input or payloads.
			a.log.Info("http_request", "request_id", requestID, "method", r.Method, "status", status, "duration_ms", elapsed.Milliseconds())
		}()
		handler.ServeHTTP(w, r)
	})
}
func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
