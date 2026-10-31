package httpapi

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
)

func registerCoverage(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := detection.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/detection-coverage", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		result, err := store.Coverage(r.Context(), auth.From(r.Context()).Tenant)
		return result, 200, err
	}))
	mux.HandleFunc("PUT /api/v1/detection-coverage/{id}", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		var in detection.CoverageInput
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if err := d.Decode(&in); err != nil {
			return nil, 0, invalid()
		}
		if err := d.Decode(new(any)); err != io.EOF {
			return nil, 0, invalid()
		}
		p := auth.From(r.Context())
		v, err := store.SaveCoverage(r.Context(), p.Tenant, p.ID, r.PathValue("id"), in)
		return map[string]int{"version": v}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/detection-coverage/{id}/history", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		rows, err := investigations.ResourceHistory(r.Context(), pool, auth.From(r.Context()).Tenant, "detection_coverage", "17.1:"+r.PathValue("id"))
		return map[string]any{"items": rows}, 200, err
	}))
}
