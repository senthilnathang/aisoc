package httpapi

import (
	"aisoc/backend/internal/modules/approvals"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
)

func registerApprovalInbox(mux *http.ServeMux, pool *pgxpool.Pool) {
	mux.HandleFunc("GET /api/v1/approvals", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		for k, v := range q {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			switch k {
			case "kind", "stage", "search", "limit", "offset":
			default:
				return nil, 0, invalid()
			}
		}
		limit, offset := 25, 0
		for key, dst := range map[string]*int{"limit": &limit, "offset": &offset} {
			if q.Has(key) {
				v, e := strconv.Atoi(q.Get(key))
				if e != nil {
					return nil, 0, invalid()
				}
				*dst = v
			}
		}
		kind, stage := q.Get("kind"), q.Get("stage")
		if kind == "" {
			kind = "all"
		}
		if stage == "" {
			stage = "all"
		}
		result, err := (approvals.Store{Pool: pool}).Inbox(r.Context(), auth.From(r.Context()).Tenant, kind, stage, q.Get("search"), limit, offset)
		return result, 200, err
	}))
}
