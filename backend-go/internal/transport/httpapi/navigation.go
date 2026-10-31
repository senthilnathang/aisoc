package httpapi

import (
	"aisoc/backend/internal/modules/navigation"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerNavigation(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := navigation.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/navigation/breadcrumb", respond(func(r *http.Request) (any, int, error) {
		query := r.URL.Query()
		if len(query) != 2 || len(query["resource"]) != 1 || len(query["id"]) != 1 {
			return nil, 0, invalid()
		}
		resource, id := query.Get("resource"), query.Get("id")
		label, err := store.Label(r.Context(), auth.From(r.Context()).Tenant, resource, id)
		if err != nil {
			return nil, 0, err
		}
		return map[string]string{"resource": resource, "id": id, "label": label}, http.StatusOK, nil
	}))
}
