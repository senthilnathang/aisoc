package httpapi

import (
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func sourceInput(r *http.Request, create bool) (map[string]any, error) {
	days := &responseRule{kind: "integer", min: 1, max: 365, bounded: true}
	fields := []responseField{{"expires_in_days", days}}
	if create {
		rule := textRule(1, 1048576)
		rule.nonblank = false
		fields = []responseField{{"name", textRule(1, 200)}, {"provider", textRule(1, 100)}, {"rule_id", rule}, {"expires_in_days", days}}
	}
	schema := objectRule(fields...)
	schema.optional = map[string]bool{"expires_in_days": true}
	value, err := decodeBody(r)
	if err != nil {
		return nil, err
	}
	value, details := validateRule(value, schema, "", "#")
	if len(details) > 0 {
		return nil, validationFailure("body", details)
	}
	input := value.(map[string]any)
	if _, ok := input["expires_in_days"]; !ok {
		input["expires_in_days"] = float64(30)
	}
	return input, nil
}
func registerSources(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := intake.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/api-sources", respond(func(r *http.Request) (any, int, error) {
		items, err := store.List(r.Context(), auth.From(r.Context()).Tenant)
		return map[string]any{"items": items}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/api-sources/{id}", respond(func(r *http.Request) (any, int, error) {
		item, err := store.Get(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return item, 200, err
	}))
	noStore := func(fn func(*http.Request) (any, int, error)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			respond(fn)(w, r)
		}
	}
	mux.HandleFunc("POST /api/v1/api-sources", noStore(func(r *http.Request) (any, int, error) {
		input, err := sourceInput(r, true)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := store.Create(r.Context(), p.Tenant, input["name"].(string), input["provider"].(string), input["rule_id"].(string), int(input["expires_in_days"].(float64)), p.ID)
		return result, 201, err
	}))
	mux.HandleFunc("POST /api/v1/api-sources/{id}/rotate-key", noStore(func(r *http.Request) (any, int, error) {
		input, err := sourceInput(r, false)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := store.Mutate(r.Context(), p.Tenant, r.PathValue("id"), int(input["expires_in_days"].(float64)), p.ID, false)
		return result, 200, err
	}))
	mux.HandleFunc("POST /api/v1/api-sources/{id}/revoke", respond(func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		result, err := store.Mutate(r.Context(), p.Tenant, r.PathValue("id"), 0, p.ID, true)
		return result, 200, err
	}))
}
