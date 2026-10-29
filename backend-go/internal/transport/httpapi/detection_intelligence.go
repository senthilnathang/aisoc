package httpapi

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func registerIntelligence(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := detection.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/detection-intelligence", respond(func(r *http.Request) (any, int, error) {
		schema := objectRule(responseField{"days", &responseRule{kind: "integer", min: 1, max: 90, bounded: true}}, responseField{"source", textRule(0, 200)}, responseField{"severity", &responseRule{choices: []string{"low", "medium", "high", "critical"}}})
		schema.optional = map[string]bool{"days": true, "source": true, "severity": true}
		raw := map[string]any{}
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
		if _, ok := raw["days"]; !ok {
			raw["days"] = float64(7)
		}
		value, details := validateRule(raw, schema, "", "#")
		if len(details) > 0 {
			return nil, 0, validationFailure("querystring", details)
		}
		input := value.(map[string]any)
		source, _ := input["source"].(string)
		severity, _ := input["severity"].(string)
		result, err := store.Intelligence(r.Context(), auth.From(r.Context()).Tenant, detection.IntelligenceOptions{Days: int(input["days"].(float64)), Source: source, Severity: severity})
		return result, 200, err
	}))
}
