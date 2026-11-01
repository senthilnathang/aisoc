package httpapi

import (
	buildcatalog "aisoc/backend/internal/modules/build"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
)

func registerBuild(mux *http.ServeMux, pool *pgxpool.Pool) {
	mux.HandleFunc("GET /api/v1/build/catalog", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		for k, v := range q {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			switch k {
			case "kind", "search", "limit", "offset":
			default:
				return nil, 0, invalid()
			}
		}
		limit, offset := 25, 0
		var err error
		if q.Has("limit") {
			limit, err = strconv.Atoi(q.Get("limit"))
			if err != nil {
				return nil, 0, invalid()
			}
		}
		if q.Has("offset") {
			offset, err = strconv.Atoi(q.Get("offset"))
			if err != nil {
				return nil, 0, invalid()
			}
		}
		kind := q.Get("kind")
		if kind == "" {
			kind = "all"
		}
		result, err := (buildcatalog.Store{Pool: pool}).Catalog(r.Context(), auth.From(r.Context()).Tenant, kind, q.Get("search"), limit, offset)
		return result, 200, err
	}))
}
