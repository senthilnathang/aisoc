package httpapi

import (
	"aisoc/backend/internal/modules/response"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/eventstate"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerCaseSandbox(mux *http.ServeMux, pool *pgxpool.Pool, scopes []config.StreamScope) {
	store := response.Store{Pool: pool}
	allowed := func(r *http.Request) []config.StreamScope {
		actor := auth.From(r.Context())
		out := []config.StreamScope{}
		for _, scope := range scopes {
			if scope.AllowSandboxResponse && scope.OperatorID == actor.ID && scope.TenantID == actor.Tenant {
				out = append(out, scope)
			}
		}
		return out
	}
	list := func(r *http.Request) (any, int, error) {
		items, err := store.CaseSandboxList(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		if err != nil {
			return nil, 0, err
		}
		grants := []map[string]string{}
		for _, s := range allowed(r) {
			grants = append(grants, map[string]string{"id": s.ID, "connector_id": s.ConnectorID, "source": s.Source})
		}
		return map[string]any{"items": items, "scopes": grants, "mode": "sandbox", "external_calls": 0, "limit": 100}, 200, nil
	}
	mux.HandleFunc("GET /api/v1/investigations/{id}/sandbox-responses", respond(list))
	mux.HandleFunc("GET /api/v1/sandbox-responses", respond(list))
	mux.HandleFunc("POST /api/v1/investigations/{id}/sandbox-responses", respond(func(r *http.Request) (any, int, error) {
		var in response.CaseSandboxRequest
		if err := streamBody(r, &in); err != nil {
			return nil, 0, streamError(err)
		}
		actor := auth.From(r.Context())
		for _, s := range allowed(r) {
			if s.ID == in.ScopeID {
				b := telemetry.Binding{TenantID: actor.Tenant, ConnectorID: s.ConnectorID, Source: s.Source}
				result, err := store.CaseSandbox(r.Context(), actor, r.PathValue("id"), b, []response.SandboxGrant{{Actor: actor, Binding: b}}, in)
				return result, 200, streamError(err)
			}
		}
		return nil, 0, streamError(eventstate.ErrRecoveryDenied)
	}))
}
