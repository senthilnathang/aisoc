package httpapi

import (
	"aisoc/backend/internal/modules/routing"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerDetectionRouting(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := routing.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/detection-routing", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		v, e := s.Get(r.Context(), auth.From(r.Context()).Tenant)
		return v, 200, e
	}))
	mux.HandleFunc("GET /api/v1/detection-routing/audit", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		v, e := s.Audit(r.Context(), auth.From(r.Context()).Tenant)
		return map[string]any{"items": v}, 200, e
	}))
	mux.HandleFunc("POST /api/v1/detection-routing/preview", respond(func(r *http.Request) (any, int, error) {
		var in routing.PreviewInput
		if e := strictRecommendationBody(r, &in); e != nil {
			return nil, 0, e
		}
		p := auth.From(r.Context())
		v, e := s.Simulate(r.Context(), p.Tenant, p.ID, in)
		return v, 200, e
	}))
	mux.HandleFunc("PUT /api/v1/detection-routing", respond(func(r *http.Request) (any, int, error) {
		var in routing.SaveInput
		if e := strictRecommendationBody(r, &in); e != nil {
			return nil, 0, e
		}
		p := auth.From(r.Context())
		v, e := s.Save(r.Context(), p.Tenant, p.ID, in)
		return v, 200, e
	}))
}
