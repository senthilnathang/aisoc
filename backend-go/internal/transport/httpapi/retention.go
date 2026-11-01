package httpapi

import (
	"aisoc/backend/internal/modules/retention"
	"aisoc/backend/internal/platform/auth"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
	"time"
)

func registerRetention(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := retention.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/build/retention", respond(func(r *http.Request) (any, int, error) {
		for k, v := range r.URL.Query() {
			if len(v) != 1 || (k != "kind" && k != "offset") {
				return nil, 0, invalid()
			}
		}
		offset := 0
		var e error
		if r.URL.Query().Has("offset") {
			offset, e = strconv.Atoi(r.URL.Query().Get("offset"))
			if e != nil {
				return nil, 0, invalid()
			}
		}
		kind := r.URL.Query().Get("kind")
		if kind == "" {
			kind = "notification"
		}
		p := auth.From(r.Context())
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		v, e := s.Preview(ctx, p.Tenant, p.ID, kind, offset)
		return v, 200, e
	}))
	mux.HandleFunc("GET /api/v1/build/retention/archives/{id}", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		p := auth.From(r.Context())
		v, e := s.Snapshot(r.Context(), p.Tenant, p.ID, r.PathValue("id"))
		return v, 200, e
	}))
	mux.HandleFunc("POST /api/v1/build/retention/policy", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		var in retention.PolicyInput
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		v, e := s.Configure(ctx, p.Tenant, p.ID, in)
		return v, 200, e
	}))
	mux.HandleFunc("POST /api/v1/build/retention/actions", respond(func(r *http.Request) (any, int, error) {
		if len(r.URL.Query()) > 0 {
			return nil, 0, invalid()
		}
		var in retention.ActionInput
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		p := auth.From(r.Context())
		v, e := s.Act(r.Context(), p.Tenant, p.ID, in)
		return v, 200, e
	}))
}
