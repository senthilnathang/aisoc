package httpapi

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func skillSchema(material bool) *responseRule {
	var rule *responseRule
	if material {
		rule = objectRule(responseField{"name", textRule(1, 180)}, responseField{"kind", &responseRule{choices: []string{"reference", "checklist", "example"}}}, responseField{"filename", textRule(0, 255)}, responseField{"source_url", textRule(0, 2048)}, responseField{"content", textRule(0, 150000)})
	} else {
		rule = objectRule(responseField{"name", textRule(1, 200)}, responseField{"skill_type", &responseRule{choices: []string{"strategy", "content"}}}, responseField{"description", textRule(0, 4000)}, responseField{"apply_when", textRule(0, 4000)}, responseField{"content_markdown", textRule(0, 30000)})
		for _, f := range []struct {
			name          string
			length, count int
		}{{"modules", 100, 20}, {"connectors", 120, 100}, {"alert_types", 120, 100}, {"alert_categories", 120, 100}, {"source_entities", 200, 100}, {"runtime_entities", 200, 100}, {"insight_refs", 200, 100}, {"tags", 100, 100}} {
			rule.fields = append(rule.fields, responseField{f.name, &responseRule{kind: "array", max: f.count, bounded: true, item: textRule(0, f.length)}})
		}
	}
	rule.optional = map[string]bool{}
	for _, f := range rule.fields {
		rule.optional[f.name] = true
	}
	return rule
}
func schemaInput(r *http.Request, schema *responseRule) (map[string]any, error) {
	raw, err := body(r)
	if err != nil {
		return nil, err
	}
	encoded, _ := json.Marshal(raw)
	var input any
	_ = json.Unmarshal(encoded, &input)
	v, details := validateRule(input, schema, "", "#")
	if len(details) > 0 {
		return nil, validationFailure("body", details)
	}
	return v.(map[string]any), nil
}
func skillOptions(r *http.Request) (skills.Options, error) {
	schema := objectRule(responseField{"search", textRule(0, 200)}, responseField{"state", &responseRule{choices: []string{"draft", "published"}}}, responseField{"module", textRule(0, 100)}, responseField{"limit", &responseRule{kind: "integer", min: 1, max: 100, bounded: true}}, responseField{"offset", &responseRule{kind: "integer", min: 0}})
	schema.optional = map[string]bool{"search": true, "state": true, "module": true, "limit": true, "offset": true}
	raw := map[string]any{"limit": float64(25), "offset": float64(0)}
	for k, values := range r.URL.Query() {
		if len(values) == 1 {
			raw[k] = values[0]
		} else {
			a := []any{}
			for _, v := range values {
				a = append(a, v)
			}
			raw[k] = a
		}
	}
	value, details := validateRule(raw, schema, "", "#")
	if len(details) > 0 {
		return skills.Options{}, validationFailure("querystring", details)
	}
	v := value.(map[string]any)
	search, _ := v["search"].(string)
	state, _ := v["state"].(string)
	module, _ := v["module"].(string)
	return skills.Options{Search: search, State: state, Module: module, Limit: int(v["limit"].(float64)), Offset: int(v["offset"].(float64))}, nil
}
func registerSkills(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := skills.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/skills/suggestions", respond(func(r *http.Request) (any, int, error) {
		schema := objectRule(responseField{"status", &responseRule{choices: []string{"pending", "accepted", "dismissed"}}}, responseField{"refresh", &responseRule{choices: []string{"true", "false"}}})
		schema.optional = map[string]bool{"status": true, "refresh": true}
		raw := map[string]any{"status": "pending"}
		for k, values := range r.URL.Query() {
			if len(values) == 1 {
				raw[k] = values[0]
			} else {
				a := []any{}
				for _, v := range values {
					a = append(a, v)
				}
				raw[k] = a
			}
		}
		input, details := validateRule(raw, schema, "", "#")
		if len(details) > 0 {
			return nil, 0, validationFailure("querystring", details)
		}
		v, err := store.Suggestions(r.Context(), auth.From(r.Context()).Tenant, input.(map[string]any)["status"].(string))
		return v, 200, err
	}))
	for _, op := range []string{"accept", "dismiss"} {
		mux.HandleFunc("POST /api/v1/skills/suggestions/{id}/"+op, respond(func(r *http.Request) (any, int, error) {
			p := auth.From(r.Context())
			v, err := store.ReviewSuggestion(r.Context(), p.Tenant, r.PathValue("id"), op, p.ID)
			status := 200
			if op == "accept" {
				status = 201
			}
			return v, status, err
		}))
	}
	mux.HandleFunc("GET /api/v1/skills/outcomes", respond(func(r *http.Request) (any, int, error) {
		v, err := store.Outcomes(r.Context(), auth.From(r.Context()).Tenant)
		return v, 200, err
	}))
	mux.HandleFunc("POST /api/v1/skills/applications/{id}/feedback", respond(func(r *http.Request) (any, int, error) {
		schema := objectRule(responseField{"rating", &responseRule{choices: []string{"helpful", "not_helpful"}}}, responseField{"comment", textRule(0, 2000)})
		schema.optional = map[string]bool{"comment": true}
		input, err := schemaInput(r, schema)
		if err != nil {
			return nil, 0, err
		}
		comment, _ := input["comment"].(string)
		p := auth.From(r.Context())
		v, err := store.Feedback(r.Context(), p.Tenant, r.PathValue("id"), p.ID, input["rating"].(string), comment)
		return v, 201, err
	}))
	mux.HandleFunc("GET /api/v1/skills", respond(func(r *http.Request) (any, int, error) {
		o, err := skillOptions(r)
		if err != nil {
			return nil, 0, err
		}
		v, err := store.List(r.Context(), auth.From(r.Context()).Tenant, o)
		return v, 200, err
	}))
	mux.HandleFunc("GET /api/v1/skills/{id}", respond(func(r *http.Request) (any, int, error) {
		v, err := store.Get(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return v, 200, err
	}))
	mux.HandleFunc("GET /api/v1/skills/{id}/history", respond(func(r *http.Request) (any, int, error) {
		v, err := investigations.ResourceHistory(r.Context(), pool, auth.From(r.Context()).Tenant, "skill", r.PathValue("id"))
		return map[string]any{"items": v}, 200, err
	}))
	for _, op := range []struct {
		method, path, operation string
		status                  int
	}{{"POST", "", "create", 201}, {"PATCH", "/{id}", "patch", 200}, {"DELETE", "/{id}", "delete", 204}, {"POST", "/{id}/publish", "publish", 200}, {"POST", "/{id}/toggle", "toggle", 200}} {
		mux.HandleFunc(op.method+" /api/v1/skills"+op.path, respond(func(r *http.Request) (any, int, error) {
			var input map[string]any
			var err error
			if op.operation == "create" || op.operation == "patch" {
				input, err = schemaInput(r, skillSchema(false))
				if err != nil {
					return nil, 0, err
				}
			}
			p := auth.From(r.Context())
			v, err := store.Mutate(r.Context(), p.Tenant, r.PathValue("id"), op.operation, p.ID, input)
			return v, op.status, err
		}))
	}
	mux.HandleFunc("GET /api/v1/skills/{id}/materials", respond(func(r *http.Request) (any, int, error) {
		v, err := store.Materials(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return v, 200, err
	}))
	mux.HandleFunc("GET /api/v1/skills/{id}/materials/{materialId}", respond(func(r *http.Request) (any, int, error) {
		v, err := store.Material(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), r.PathValue("materialId"))
		return v, 200, err
	}))
	mux.HandleFunc("GET /api/v1/skills/{id}/materials/{materialId}/versions", respond(func(r *http.Request) (any, int, error) {
		v, err := store.Versions(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), r.PathValue("materialId"))
		return v, 200, err
	}))
	for _, op := range []struct {
		method, path, operation string
		status                  int
	}{{"POST", "", "create", 201}, {"PATCH", "/{materialId}", "patch", 200}, {"DELETE", "/{materialId}", "delete", 204}} {
		mux.HandleFunc(op.method+" /api/v1/skills/{id}/materials"+op.path, respond(func(r *http.Request) (any, int, error) {
			var input map[string]any
			var err error
			if op.operation != "delete" {
				input, err = schemaInput(r, skillSchema(true))
				if err != nil {
					return nil, 0, err
				}
			}
			p := auth.From(r.Context())
			v, err := store.MutateMaterial(r.Context(), p.Tenant, r.PathValue("id"), r.PathValue("materialId"), op.operation, p.ID, input)
			return v, op.status, err
		}))
	}
}
