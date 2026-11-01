package httpapi

import (
	"aisoc/backend/internal/modules/learning"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerLearning(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := learning.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/investigations/{id}/learning", respond(func(r *http.Request) (any, int, error) {
		v, e := s.Workspace(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return v, 200, e
	}))
	mux.HandleFunc("POST /api/v1/investigations/{id}/learning", respond(func(r *http.Request) (any, int, error) {
		var in learning.Input
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		v, e := s.Approve(r.Context(), p.Tenant, r.PathValue("id"), p.ID, in)
		return v, 200, e
	}))
}
