package httpapi

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
)

func insightInput(r *http.Request, create, archive bool) (insights.Input, error) {
	schema := objectRule(responseField{"artifact", textRule(1, 300)}, responseField{"kind", &responseRule{choices: []string{"user", "network", "software", "other"}}}, responseField{"content", textRule(1, 8000)}, responseField{"hint", &responseRule{choices: []string{"none", "benign", "suspicious", "malicious"}}}, responseField{"valid_from", textRule(0, 50)}, responseField{"valid_until", textRule(0, 50)})
	schema.optional = map[string]bool{"hint": true, "valid_from": true, "valid_until": true}
	if create {
		schema.fields = append(schema.fields, responseField{"id", textRule(8, 100)}, responseField{"from_prevalence", boolRule})
		schema.optional["from_prevalence"] = true
	} else {
		schema.fields = append(schema.fields, responseField{"expected_version", &responseRule{kind: "integer", min: 1, max: 2147483647, bounded: true}})
	}
	if archive {
		schema = objectRule(responseField{"expected_version", &responseRule{kind: "integer", min: 1, max: 2147483647, bounded: true}})
	}
	raw, err := strictSkillBody(r, schema)
	if err != nil {
		return insights.Input{}, err
	}
	if x, ok := raw["from_prevalence"]; ok {
		if _, ok = x.(bool); !ok {
			return insights.Input{}, invalid()
		}
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return insights.Input{}, err
	}
	var in insights.Input
	err = json.Unmarshal(encoded, &in)
	return in, err
}
func registerInsights(mux *http.ServeMux, pool *pgxpool.Pool) {
	s := insights.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/enterprise-insights", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		for k, v := range q {
			if len(v) != 1 {
				return nil, 0, invalid()
			}
			switch k {
			case "tab", "search", "limit", "offset":
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
		tab := q.Get("tab")
		if tab == "" {
			tab = "active"
		}
		v, err := s.Workspace(r.Context(), auth.From(r.Context()).Tenant, tab, q.Get("search"), limit, offset)
		return v, 200, err
	}))
	mux.HandleFunc("GET /api/v1/enterprise-insights/{id}/uses", respond(func(r *http.Request) (any, int, error) {
		v, err := s.Uses(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return v, 200, err
	}))
	for _, op := range []struct {
		method, path    string
		create, archive bool
	}{{"POST", "", true, false}, {"PUT", "/{id}", false, false}, {"POST", "/{id}/archive", false, true}} {
		mux.HandleFunc(op.method+" /api/v1/enterprise-insights"+op.path, respond(func(r *http.Request) (any, int, error) {
			in, err := insightInput(r, op.create, op.archive)
			if err != nil {
				return nil, 0, err
			}
			p := auth.From(r.Context())
			v, err := s.Save(r.Context(), p.Tenant, p.ID, r.PathValue("id"), in, op.archive)
			return v, 200, err
		}))
	}
}
