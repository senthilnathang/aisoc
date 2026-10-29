package httpapi

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerDashboard(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := investigations.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/dashboard", respond(func(r *http.Request) (any, int, error) {
		result, err := store.Dashboard(r.Context(), auth.From(r.Context()).Tenant)
		return result, 200, err
	}))
}
