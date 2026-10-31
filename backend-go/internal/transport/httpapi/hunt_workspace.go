package httpapi

import (
	"aisoc/backend/internal/modules/hunts"
	"aisoc/backend/internal/platform/auth"
	"net/http"
)

func registerHuntWorkspace(mux *http.ServeMux, s hunts.Store) {
	mux.HandleFunc("GET /api/v1/hunts/{id}/workspace", respond(func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		w, err := s.Workspace(r.Context(), p.Tenant, r.PathValue("id"))
		return w, 200, err
	}))
	mux.HandleFunc("POST /api/v1/hunts/{id}/search", respond(func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, objectRule(responseField{"id", textRule(1, 100)}, responseField{"expected_updated_at", textRule(1, 40)}))
		if err != nil {
			return nil, 0, err
		}
		key, err := stringField(raw, "id", 1, 100)
		if err != nil {
			return nil, 0, err
		}
		expected, err := stringField(raw, "expected_updated_at", 1, 40)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := s.Search(r.Context(), p.Tenant, r.PathValue("id"), p.ID, key, expected)
		return result, 200, err
	}))
	mux.HandleFunc("POST /api/v1/hunts/{id}/notes", respond(func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, objectRule(responseField{"id", textRule(1, 100)}, responseField{"body", textRule(1, 4000)}))
		if err != nil {
			return nil, 0, err
		}
		key, err := stringField(raw, "id", 1, 100)
		if err != nil {
			return nil, 0, err
		}
		body, err := stringField(raw, "body", 1, 4000)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		err = s.AddNote(r.Context(), p.Tenant, r.PathValue("id"), p.ID, key, body)
		return map[string]any{"saved": err == nil}, 200, err
	}))
}
