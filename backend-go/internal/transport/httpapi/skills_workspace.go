package httpapi

import (
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/auth"
	"net/http"
	"strconv"
)

func registerSkillsWorkspace(mux *http.ServeMux, s skills.Store) {
	mux.HandleFunc("GET /api/v1/skills/library", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		for k, v := range q {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			switch k {
			case "search", "state", "module", "origin", "limit", "offset":
			default:
				return nil, 0, invalid()
			}
		}
		limit, offset := 25, 0
		var err error
		if q.Has("limit") {
			limit, err = strconv.Atoi(q.Get("limit"))
			if err != nil {
				return nil, 0, invalid()
			}
		}
		if q.Has("offset") {
			offset, err = strconv.Atoi(q.Get("offset"))
			if err != nil {
				return nil, 0, invalid()
			}
		}
		v, err := s.Library(r.Context(), auth.From(r.Context()).Tenant, skills.Options{Search: q.Get("search"), State: q.Get("state"), Module: q.Get("module"), Limit: limit, Offset: offset}, q.Get("origin"))
		return v, 200, err
	}))
	mux.HandleFunc("PATCH /api/v1/skills/{id}/workspace", respond(func(r *http.Request) (any, int, error) {
		schema := skillSchema(false)
		schema.fields = append(schema.fields, responseField{"expected_version", &responseRule{kind: "integer", min: 1, max: 2147483647, bounded: true}}, responseField{"publish", &responseRule{kind: "boolean"}})
		schema.optional["publish"] = true
		raw, err := strictSkillBody(r, schema)
		if err != nil {
			return nil, 0, err
		}
		op := "patch"
		if raw["publish"] == true {
			op = "save-publish"
		}
		delete(raw, "publish")
		p := auth.From(r.Context())
		v, err := s.Mutate(r.Context(), p.Tenant, r.PathValue("id"), op, p.ID, raw)
		return v, 200, err
	}))
	mux.HandleFunc("PUT /api/v1/skills/{id}/enabled", respond(func(r *http.Request) (any, int, error) {
		raw, err := strictSkillBody(r, objectRule(responseField{"expected_version", &responseRule{kind: "integer", min: 1, max: 2147483647, bounded: true}}, responseField{"enabled", &responseRule{kind: "boolean"}}))
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		v, err := s.Mutate(r.Context(), p.Tenant, r.PathValue("id"), "set-enabled", p.ID, raw)
		return v, 200, err
	}))
}

// Workspace writes reject unknown keys and coercion of revision/boolean controls.
func strictSkillBody(r *http.Request, schema *responseRule) (map[string]any, error) {
	value, err := decodeBody(r)
	if err != nil {
		return nil, err
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return nil, invalid()
	}
	for k, v := range raw {
		found := false
		for _, f := range schema.fields {
			if f.name == k {
				found = true
			}
		}
		if !found {
			return nil, invalid()
		}
		switch k {
		case "expected_version":
			if _, ok := v.(float64); !ok {
				return nil, invalid()
			}
		case "publish", "enabled", "from_prevalence":
			if _, ok := v.(bool); !ok {
				return nil, invalid()
			}
		}
	}
	result, details := validateRule(raw, schema, "", "#")
	if len(details) > 0 {
		return nil, validationFailure("body", details)
	}
	return result.(map[string]any), nil
}
