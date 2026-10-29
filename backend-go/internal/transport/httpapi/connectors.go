package httpapi

import (
	"aisoc/backend/internal/modules/connectors"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerConnectors(mux *http.ServeMux, pool *pgxpool.Pool, key []byte) {
	store := connectors.Store{Pool: pool, Key: key}
	mux.HandleFunc("GET /api/v1/connectors", respond(func(r *http.Request) (any, int, error) {
		o, err := threatOptions(r)
		if err != nil {
			return nil, 0, err
		}
		items, err := store.List(r.Context(), auth.From(r.Context()).Tenant, o.Search, o.Status, o.Limit, o.Offset)
		return map[string]any{"items": items}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/connectors/{id}", respond(func(r *http.Request) (any, int, error) {
		item, err := store.Detail(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return item, 200, err
	}))
	for _, op := range []struct {
		method, suffix, operation string
		status                    int
	}{{"POST", "", "create", 201}, {"PATCH", "/{id}", "patch", 200}, {"DELETE", "/{id}", "delete", 204}, {"POST", "/{id}/test", "test", 200}} {
		mux.HandleFunc(op.method+" /api/v1/connectors"+op.suffix, respond(func(r *http.Request) (any, int, error) {
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
				text := &responseRule{kind: "string", max: 1048576}
				required := &responseRule{kind: "string", min: 1, max: 1048576}
				schema := objectRule(responseField{"type", required}, responseField{"name", required}, responseField{"description", text}, responseField{"workspace_url", text}, responseField{"client_id", text}, responseField{"secret", text}, responseField{"config", &responseRule{kind: "object", preserve: true}})
				schema.optional = map[string]bool{"description": true, "workspace_url": true, "client_id": true, "secret": true, "config": true}

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
