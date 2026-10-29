package httpapi

import (
	"encoding/json"
	"net/http"

	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/eventstate"
	"github.com/jackc/pgx/v5/pgxpool"
)

func registerStreamMockImport(mux *http.ServeMux, pool *pgxpool.Pool, scopes []config.StreamScope) {
	mux.HandleFunc("GET /api/v1/stream-operations/{scope}/mock-example", streamRespond(func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		for _, s := range scopes {
			if s.ID == r.PathValue("scope") && s.OperatorID == p.ID && s.TenantID == p.Tenant && s.AllowMockImport {
				events, err := qradarmock.LoginPage(telemetry.Binding{TenantID: s.TenantID, ConnectorID: s.ConnectorID, Source: s.Source})
				return map[string]any{"schema_version": "1.0", "expected_checkpoint": eventstate.Checkpoint{}, "next_cursor": "mock-login-v1", "events": events}, 200, err
			}
		}
		return nil, 0, streamError(eventstate.ErrRecoveryDenied)
	}))
	mux.HandleFunc("POST /api/v1/stream-operations/{scope}/mock-import", streamRespond(func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		var scope *config.StreamScope
		for i := range scopes {
			s := &scopes[i]
			if s.ID == r.PathValue("scope") && s.OperatorID == p.ID && s.TenantID == p.Tenant && s.AllowMockImport {
				scope = s
				break
			}
		}
		if scope == nil {
			return nil, 0, streamError(eventstate.ErrRecoveryDenied)
		}
		var page struct {
			SchemaVersion string                `json:"schema_version"`
			Expected      eventstate.Checkpoint `json:"expected_checkpoint"`
			Next          string                `json:"next_cursor"`
			Events        []json.RawMessage     `json:"events"`
		}
		if err := streamBody(r, &page); err != nil {
			return nil, 0, streamError(err)
		}
		if page.SchemaVersion != "1.0" || len(page.Events) == 0 || len(page.Events) > 100 {
			return nil, 0, streamError(eventstate.ErrInvalid)
		}
		b := telemetry.Binding{TenantID: scope.TenantID, ConnectorID: scope.ConnectorID, Source: scope.Source}
		events := make([]telemetry.Event, len(page.Events))
		for i, raw := range page.Events {
			e, err := telemetry.Decode(raw, b)
			if err != nil {
				return nil, 0, streamError(eventstate.ErrInvalid)
			}
			events[i] = e
		}
		if _, err := pool.Exec(r.Context(), `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, b.TenantID); err != nil {
			return nil, 0, err
		}
		receipt, err := (eventstate.Store{Pool: pool, MaxEvents: 1000, MaxPayloadBytes: 16 << 20}).Accept(r.Context(), b, page.Expected, page.Next, events)
		return map[string]any{"mode": "mock-json", "accepted": receipt, "privileged_actions_enabled": false}, 202, streamError(err)
	}))
}
