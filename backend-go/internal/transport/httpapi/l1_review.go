package httpapi

import (
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerL1Review(mux *http.ServeMux, pool *pgxpool.Pool, scopes []config.StreamScope) {
	mux.HandleFunc("GET /api/v1/investigations/{id}/l1", respond(func(r *http.Request) (any, int, error) {
		view, err := l1.CaseReview(r.Context(), pool, auth.From(r.Context()).Tenant, r.PathValue("id"))
		actor := auth.From(r.Context())
		for _, scope := range scopes {
			if scope.RequireAnalystReview && scope.OperatorID == actor.ID && scope.TenantID == actor.Tenant && scope.ConnectorID == view.ConnectorID && scope.Source == view.Source {
				view.ReviewScope = scope.ID
				break
			}
		}
		return view, 200, err
	}))
}
