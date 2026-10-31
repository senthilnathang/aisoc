package httpapi

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerInvestigationWorkspace(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := investigations.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/investigations/{id}/workspace", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		v, e := s.Workspace(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return v, 200, e
	}))
	mux.HandleFunc("GET /api/v1/investigations/{id}/evidence-chat", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		p := auth.From(r.Context())
		v, e := s.EvidenceMessages(r.Context(), p.Tenant, r.PathValue("id"), p.ID)
		return map[string]any{"items": v, "mode": "local-evidence-lookup"}, 200, e
	}))
	mux.HandleFunc("POST /api/v1/investigations/{id}/evidence-chat", respond(func(r *http.Request) (any, int, error) {
		var in investigations.LookupInput
		if e := strictRecommendationBody(r, &in); e != nil {
			return nil, 0, e
		}
		p := auth.From(r.Context())
		v, e := s.AskEvidence(r.Context(), p.Tenant, r.PathValue("id"), p.ID, in)
		return v, 200, e
	}))
}
