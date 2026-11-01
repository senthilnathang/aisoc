package httpapi

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
)

func registerCaseDetectionFeedback(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := detection.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/investigations/{id}/detection-feedback", respond(func(r *http.Request) (any, int, error) {
		limit, offset := 25, 0
		for k, v := range r.URL.Query() {
			if len(v) != 1 || (k != "limit" && k != "offset") {
				return nil, 0, invalid()
			}
			n, e := strconv.Atoi(v[0])
			if e != nil {
				return nil, 0, invalid()
			}
			if k == "limit" {
				limit = n
			} else {
				offset = n
			}
		}
		v, e := s.CaseFeedback(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), limit, offset)
		return v, 200, e
	}))
	mux.HandleFunc("PUT /api/v1/investigations/{id}/detection-feedback/{alert}", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		var in detection.CaseAlertLabelInput
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		v, e := s.LabelCaseAlert(r.Context(), p.Tenant, p.ID, r.PathValue("id"), r.PathValue("alert"), in)
		return v, 200, e
	}))
}
