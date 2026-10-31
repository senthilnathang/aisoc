package httpapi

import (
	"aisoc/backend/internal/modules/threatintel"
	"aisoc/backend/internal/platform/auth"
	"net/http"
	"strconv"
)

func registerThreatWorkspace(mux *http.ServeMux, s threatintel.Store) {
	mux.HandleFunc("GET /api/v1/threat-intel/registry", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		for k, v := range q {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			switch k {
			case "search", "status", "relevant", "limit", "offset":
			default:
				return nil, 0, invalid()
			}
		}
		limit, offset := 50, 0
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
		relevant := false
		if q.Has("relevant") {
			if q.Get("relevant") != "true" && q.Get("relevant") != "false" {
				return nil, 0, invalid()
			}
			relevant = q.Get("relevant") == "true"
		}
		result, err := s.Registry(r.Context(), auth.From(r.Context()).Tenant, q.Get("search"), q.Get("status"), relevant, limit, offset)
		return result, 200, err
	}))
	mux.HandleFunc("GET /api/v1/threat-intel-reports/{id}/workspace", respond(func(r *http.Request) (any, int, error) {
		result, err := s.Workspace(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return result, 200, err
	}))
	mux.HandleFunc("POST /api/v1/threat-intel-reports/{id}/local-hunt", respond(func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, objectRule(responseField{"id", textRule(1, 100)}, responseField{"indicator_id", textRule(1, 100)}))
		if err != nil {
			return nil, 0, err
		}
		id, err := stringField(raw, "id", 1, 100)
		if err != nil {
			return nil, 0, err
		}
		indicator, err := stringField(raw, "indicator_id", 1, 100)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := s.CreateLocalHunt(r.Context(), p.Tenant, r.PathValue("id"), p.ID, id, indicator)
		return result, 200, err
	}))
}
