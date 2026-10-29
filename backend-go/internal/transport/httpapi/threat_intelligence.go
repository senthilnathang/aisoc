package httpapi

import (
	"aisoc/backend/internal/modules/threatintel"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func threatCreateSchema(k threatintel.Kind) *responseRule {
	text := &responseRule{kind: "string", max: 1048576}
	required := &responseRule{kind: "string", min: 1, max: 1048576}
	severity := &responseRule{choices: []string{"low", "medium", "high", "critical"}}
	integer := &responseRule{kind: "integer", min: 0}
	schema := objectRule(responseField{"title", required}, responseField{"summary", text}, responseField{"source", text}, responseField{"report_type", text}, responseField{"severity", severity}, responseField{"ioc_count", integer}, responseField{"tags", &responseRule{kind: "array", item: text}}, responseField{"published_at", text})
	requiredKeys := map[string]bool{"title": true, "severity": true}
	if k == threatintel.Indicators {
		schema = objectRule(responseField{"report_id", required}, responseField{"indicator_type", required}, responseField{"value", required}, responseField{"severity", severity}, responseField{"hits", integer})
		requiredKeys = map[string]bool{"report_id": true, "indicator_type": true, "value": true}
	}
	schema.optional = map[string]bool{}
	for _, field := range schema.fields {
		schema.optional[field.name] = !requiredKeys[field.name]
	}
	return schema
}
func threatOptions(r *http.Request) (threatintel.Options, error) {
	schema := objectRule(responseField{"search", &responseRule{kind: "string", max: 1048576}}, responseField{"status", &responseRule{kind: "string", max: 1048576}}, responseField{"severity", &responseRule{kind: "string", max: 1048576}}, responseField{"investigationId", &responseRule{kind: "string", max: 1048576}}, responseField{"reportId", &responseRule{kind: "string", max: 1048576}}, responseField{"limit", &responseRule{kind: "integer", min: 1, max: 500, bounded: true}}, responseField{"offset", &responseRule{kind: "integer", min: 0}})
	schema.optional = map[string]bool{}
	for _, f := range schema.fields {
		schema.optional[f.name] = true
	}
	raw := map[string]any{"limit": float64(100), "offset": float64(0)}
	for key, values := range r.URL.Query() {
		if len(values) == 1 {
			raw[key] = values[0]
		} else {
			array := []any{}
			for _, v := range values {
				array = append(array, v)
			}
			raw[key] = array
		}
	}
	value, details := validateRule(raw, schema, "", "#")
	if len(details) > 0 {
		return threatintel.Options{}, validationFailure("querystring", details)
	}
	input := value.(map[string]any)
	search, _ := input["search"].(string)
	status, _ := input["status"].(string)
	severity, _ := input["severity"].(string)
	report, _ := input["reportId"].(string)
	return threatintel.Options{Search: search, Status: status, Severity: severity, ReportID: report, Limit: int(input["limit"].(float64)), Offset: int(input["offset"].(float64))}, nil
}
func registerThreatIntelligence(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := threatintel.Store{Pool: pool}
	for _, resource := range []struct {
		path string
		kind threatintel.Kind
	}{{"/api/v1/threat-intel-reports", threatintel.Reports}, {"/api/v1/threat-indicators", threatintel.Indicators}} {
		mux.HandleFunc("GET "+resource.path, respond(func(r *http.Request) (any, int, error) {
			options, err := threatOptions(r)
			if err != nil {
				return nil, 0, err
			}
			items, err := store.List(r.Context(), resource.kind, auth.From(r.Context()).Tenant, options)
			return map[string]any{"items": items}, 200, err
		}))
		mux.HandleFunc("GET "+resource.path+"/{id}", respond(func(r *http.Request) (any, int, error) {
			item, err := store.Detail(r.Context(), resource.kind, auth.From(r.Context()).Tenant, r.PathValue("id"))
			return item, 200, err
		}))
		for _, op := range []struct {
			method, suffix, operation string
			status                    int
		}{{"POST", "", "create", 201}, {"PATCH", "/{id}", "patch", 200}, {"DELETE", "/{id}", "delete", 204}} {
			mux.HandleFunc(op.method+" "+resource.path+op.suffix, respond(func(r *http.Request) (any, int, error) {
				var raw map[string]json.RawMessage
				var keys []string
				var err error
				if op.operation != "delete" {
					raw, keys, err = orderedBody(r)
					if err != nil {
						return nil, 0, err
					}
				}
				if op.operation == "create" {
					encoded, _ := json.Marshal(raw)
					var input any
					_ = json.Unmarshal(encoded, &input)
					value, details := validateRule(input, threatCreateSchema(resource.kind), "", "#")
					if len(details) > 0 {
						return nil, 0, validationFailure("body", details)
					}
					// Generic legacy schemas permit extra keys; the store's
					// mutable-field allowlist still applies to those keys.
					for key, v := range value.(map[string]any) {
						raw[key], _ = json.Marshal(v)
					}
				}
				item, err := store.Mutate(r.Context(), resource.kind, auth.From(r.Context()).Tenant, r.PathValue("id"), op.operation, raw, keys)
				return item, op.status, err
			}))
		}
	}
	mux.HandleFunc("POST /api/v1/threat-intel-reports/{id}/launch-hunt", respond(func(r *http.Request) (any, int, error) {
		item, err := store.Mutate(r.Context(), threatintel.Reports, auth.From(r.Context()).Tenant, r.PathValue("id"), "launch", nil, nil)
		return item, 200, err
	}))
	mux.HandleFunc("GET /api/v1/threat-intel/dashboard", respond(func(r *http.Request) (any, int, error) {
		item, err := store.Dashboard(r.Context(), auth.From(r.Context()).Tenant)
		return item, 200, err
	}))
}
