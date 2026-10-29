package httpapi

import (
	"aisoc/backend/internal/modules/detection"
	"net/http"
)

func registryInput(r *http.Request) (detection.RegistryOptions, error) {
	choices := func(values ...string) *responseRule { return &responseRule{choices: values} }
	schema := objectRule(
		responseField{"search", textRule(0, 200)}, responseField{"severity", choices("low", "medium", "high", "critical")},
		responseField{"enabled", choices("true", "false")}, responseField{"source", textRule(0, 200)},
		responseField{"sort", choices("name", "updated_at", "severity", "detections")}, responseField{"direction", choices("asc", "desc")},
		responseField{"limit", &responseRule{kind: "integer", min: 1, max: 100, bounded: true}}, responseField{"offset", &responseRule{kind: "integer", min: 0}},
	)
	schema.optional = map[string]bool{}
	for _, field := range schema.fields {
		schema.optional[field.name] = true
	}
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
	value, details := validateRule(raw, schema, "", "#")
	if len(details) > 0 {
		return detection.RegistryOptions{}, validationFailure("querystring", details)
	}
	input := value.(map[string]any)
	text := func(key string) string { v, _ := input[key].(string); return v }
	options := detection.RegistryOptions{Search: text("search"), Severity: text("severity"), Enabled: text("enabled"), Source: text("source"), Sort: text("sort"), Direction: text("direction"), Limit: 25}
	if v, ok := input["limit"].(float64); ok {
		options.Limit = int(v)
	}
	if v, ok := input["offset"].(float64); ok {
		if v >= 9223372036854775808 {
			return options, invalid()
		}
		options.Offset = int(v)
	}
	return options, nil
}
