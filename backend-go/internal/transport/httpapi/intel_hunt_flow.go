package httpapi

import (
	"aisoc/backend/internal/modules/hunts"
	"aisoc/backend/internal/modules/threatintel"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerIntelHuntFlow(mux *http.ServeMux, pool *pgxpool.Pool) {
	intel := threatintel.Store{Pool: pool}
	hunt := hunts.Store{Pool: pool}
	mux.HandleFunc("POST /api/v1/threat-intel/import/preview", respond(func(r *http.Request) (any, int, error) {
		var in threatintel.IntelImport
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		v, e := threatintel.PreviewImport(in)
		return v, 200, e
	}))
	mux.HandleFunc("POST /api/v1/threat-intel/import", respond(func(r *http.Request) (any, int, error) {
		var in threatintel.IntelImport
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		v, e := intel.ImportJSON(r.Context(), p.Tenant, p.ID, in)
		return v, 200, e
	}))
	mux.HandleFunc("POST /api/v1/hunts/{id}/promote", respond(func(r *http.Request) (any, int, error) {
		var in hunts.PromoteInput
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		v, e := hunt.Promote(r.Context(), p.Tenant, r.PathValue("id"), p.ID, in)
		return v, 200, e
	}))
	mux.HandleFunc("GET /api/v1/investigations/{id}/hunt-origin", respond(func(r *http.Request) (any, int, error) {
		v, e := hunt.CaseOrigin(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return map[string]any{"items": v}, 200, e
	}))
}
