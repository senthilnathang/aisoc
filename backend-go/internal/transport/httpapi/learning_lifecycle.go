package httpapi

import (
	"aisoc/backend/internal/modules/learning"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerLearningLifecycle(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := learning.Store{Pool: pool}
	for _, kind := range []string{"skills", "enterprise-insights"} {
		mux.HandleFunc("GET /api/v1/"+kind+"/{id}/lifecycle", respond(func(r *http.Request) (any, int, error) {
			if len(r.URL.Query()) > 0 {
				return nil, 0, invalid()
			}
			v, e := s.Lifecycle(r.Context(), auth.From(r.Context()).Tenant, kind, r.PathValue("id"))
			return v, 200, e
		}))
		mux.HandleFunc("POST /api/v1/"+kind+"/{id}/lifecycle", respond(func(r *http.Request) (any, int, error) {
			if len(r.URL.Query()) > 0 {
				return nil, 0, invalid()
			}
			var in learning.LifecycleInput
			if e := streamBody(r, &in); e != nil {
				return nil, 0, streamError(e)
			}
			p := auth.From(r.Context())
			v, e := s.ReviewLifecycle(r.Context(), p.Tenant, p.ID, kind, r.PathValue("id"), in)
			return v, 200, e
		}))
	}
}
