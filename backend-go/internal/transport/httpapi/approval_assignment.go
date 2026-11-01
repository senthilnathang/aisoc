package httpapi

import (
	"aisoc/backend/internal/modules/approvals"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
)

func registerApprovalAssignments(mux *http.ServeMux, pool *pgxpool.Pool, security *auth.Manager) {
	store := approvals.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/approvals/assignment", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		for k, v := range q {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			switch k {
			case "kind", "id", "connector_id", "source":
			default:
				return nil, 0, invalid()
			}
		}
		p := auth.From(r.Context())
		key := approvals.WorkKey{Kind: q.Get("kind"), ID: q.Get("id"), Connector: q.Get("connector_id"), Source: q.Get("source")}
		result, e := store.AssignmentDetail(r.Context(), p.Tenant, p.ID, key, security.ApprovalOperators(p.Tenant))
		return result, 200, e
	}))
	mux.HandleFunc("POST /api/v1/approvals/assignment", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		var in approvals.AssignmentInput
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		result, e := store.Assign(r.Context(), p.Tenant, p.ID, in, security.ApprovalOperators(p.Tenant))
		return result, 200, e
	}))
	mux.HandleFunc("GET /api/v1/notifications", respond(func(r *http.Request) (any, int, error) {
		limit, offset := 25, 0
		for k, v := range r.URL.Query() {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			n, e := strconv.Atoi(v[0])
			if e != nil {
				return nil, 0, invalid()
			}
			switch k {
			case "limit":
				limit = n
			case "offset":
				offset = n
			default:
				return nil, 0, invalid()
			}
		}
		p := auth.From(r.Context())
		result, e := store.Notifications(r.Context(), p.Tenant, p.ID, limit, offset)
		return result, 200, e
	}))
	mux.HandleFunc("POST /api/v1/notifications/{id}/read", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		p := auth.From(r.Context())
		e := store.ReadNotification(r.Context(), p.Tenant, p.ID, r.PathValue("id"))
		return map[string]bool{"read": true}, 200, e
	}))
}
