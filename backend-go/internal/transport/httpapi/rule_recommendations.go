package httpapi

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
)

func strictRecommendationBody(r *http.Request, target any) error {
	if len(r.URL.Query()) > 0 {
		return invalid()
	}
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return invalid()
	}
	if d.Decode(new(any)) != io.EOF {
		return invalid()
	}
	return nil
}
func registerRuleRecommendations(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := detection.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/detection-rules/{id}/recommendations", respond(func(r *http.Request) (any, int, error) {
		for key := range r.URL.Query() {
			if key != "days" {
				return nil, 0, invalid()
			}
		}
		options, err := registryInput(r)
		if err != nil {
			return nil, 0, err
		}
		if options.Days == 0 {
			options.Days = 30
		}
		result, err := store.Recommendations(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), options.Days)
		return result, 200, err
	}))
	mux.HandleFunc("PUT /api/v1/detection-rules/{id}/alert-labels/{alert}", respond(func(r *http.Request) (any, int, error) {
		var in detection.AlertLabelInput
		if err := strictRecommendationBody(r, &in); err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		v, err := store.LabelAlert(r.Context(), p.Tenant, p.ID, r.PathValue("id"), r.PathValue("alert"), in)
		return map[string]int{"version": v}, 200, err
	}))
	mux.HandleFunc("POST /api/v1/detection-rules/{id}/recommendations/generate", respond(func(r *http.Request) (any, int, error) {
		var in struct {
			Days            int `json:"days"`
			ExpectedVersion int `json:"expected_version"`
		}
		if err := strictRecommendationBody(r, &in); err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		n, err := store.GenerateRecommendations(r.Context(), p.Tenant, p.ID, r.PathValue("id"), in.Days, in.ExpectedVersion)
		return map[string]int{"created": n}, 200, err
	}))
	mux.HandleFunc("POST /api/v1/detection-rules/{id}/recommendations/{recommendation}/{action}", respond(func(r *http.Request) (any, int, error) {
		var in struct{}
		if err := strictRecommendationBody(r, &in); err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := store.RecommendationAction(r.Context(), p.Tenant, p.ID, r.PathValue("id"), r.PathValue("recommendation"), r.PathValue("action"))
		return result, 200, err
	}))
}
