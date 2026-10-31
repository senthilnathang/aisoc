package httpapi

import (
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerL1Review(mux *http.ServeMux, pool *pgxpool.Pool) {
	mux.HandleFunc("GET /api/v1/investigations/{id}/l1", respond(func(r *http.Request) (any, int, error) {
		view, err := l1.CaseReview(r.Context(), pool, auth.From(r.Context()).Tenant, r.PathValue("id"))
		return view, 200, err
	}))
}
