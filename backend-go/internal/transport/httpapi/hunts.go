package httpapi

import (
	"aisoc/backend/internal/modules/hunts"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerHunts(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := hunts.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/hunts", respond(func(r *http.Request) (any, int, error) {
		o, err := threatOptions(r)
		if err != nil {
			return nil, 0, err
		}
		items, err := store.List(r.Context(), auth.From(r.Context()).Tenant, o.Search, o.Status, o.Limit, o.Offset)
		return map[string]any{"items": items}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/hunts/{id}", respond(func(r *http.Request) (any, int, error) {
		item, err := store.Detail(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return item, 200, err
	}))
	for _, op := range []struct {
		method, suffix, operation string
		status                    int
	}{{"POST", "", "create", 201}, {"PATCH", "/{id}", "patch", 200}, {"DELETE", "/{id}", "delete", 204}, {"POST", "/{id}/run", "run", 200}} {
		mux.HandleFunc(op.method+" /api/v1/hunts"+op.suffix, respond(func(r *http.Request) (any, int, error) {
			var raw map[string]json.RawMessage
			var keys []string
			var err error
			if op.operation == "create" || op.operation == "patch" {
				raw, keys, err = orderedBody(r)
				if err != nil {
					return nil, 0, err
				}
			}
			if op.operation == "create" {
				schema := objectRule(responseField{"name", &responseRule{kind: "string", min: 1, max: 1048576}}, responseField{"query", &responseRule{kind: "string", min: 1, max: 1048576}}, responseField{"source", &responseRule{kind: "string", max: 1048576}}, responseField{"insight_refs", &responseRule{kind: "array", max: 50, bounded: true, item: textRule(0, 200)}})
				schema.optional = map[string]bool{"source": true, "insight_refs": true}
				encoded, _ := json.Marshal(raw)
				var input any
				_ = json.Unmarshal(encoded, &input)
				value, details := validateRule(input, schema, "", "#")
				if len(details) > 0 {
					return nil, 0, validationFailure("body", details)
				}
				for k, v := range value.(map[string]any) {
					raw[k], _ = json.Marshal(v)
				}
			}
			item, err := store.Mutate(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), op.operation, raw, keys)
			return item, op.status, err
		}))
	}
}
