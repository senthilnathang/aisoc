package httpapi

import (
	"aisoc/backend/internal/platform/fault"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// These rules describe the response API subset, not a general JSON Schema engine.
// Field order is significant: Fastify/Ajv checks required keys before field values.
type responseRule struct {
	kind              string
	min, max          int
	bounded, nonblank bool
	fields            []responseField
	item              *responseRule
	choices           []string
	optional          map[string]bool
	preserve          bool
}
type responseField struct {
	name string
	rule *responseRule
}

func textRule(min, max int) *responseRule {
	return &responseRule{kind: "string", min: min, max: max, bounded: true, nonblank: min > 0}
}
func objectRule(fields ...responseField) *responseRule {
	return &responseRule{kind: "object", fields: fields}
}

var versionRule = &responseRule{kind: "integer", min: 1}
var boolRule = &responseRule{kind: "boolean"}
var stepRule = objectRule(responseField{"title", textRule(1, 300)}, responseField{"instructions", textRule(0, 4000)}, responseField{"approval_required", boolRule})

func planRule(edit bool) *responseRule {
	fields := []responseField{{"kind", &responseRule{choices: []string{"workflow", "runbook"}}}, {"title", textRule(1, 200)}, {"description", textRule(0, 4000)}, {"domain", textRule(1, 100)}, {"trigger", textRule(1, 500)}, {"steps", &responseRule{kind: "array", min: 1, max: 50, bounded: true, item: stepRule}}}
	if edit {
		fields = append(fields, responseField{"expected_version", versionRule})
	}
	return objectRule(fields...)
}

var stateRule = objectRule(responseField{"expected_version", versionRule}, responseField{"state", &responseRule{choices: []string{"active", "archived"}}})
var attachRule = objectRule(responseField{"plan_id", textRule(1, 100)}, responseField{"expected_version", versionRule})
var updateStepRule = objectRule(responseField{"expected_version", versionRule}, responseField{"step_index", &responseRule{kind: "integer", min: 0, max: 49, bounded: true}}, responseField{"completed", boolRule}, responseField{"note", textRule(0, 4000)}, responseField{"approval_confirmed", boolRule})

type validationDetail struct {
	InstancePath string         `json:"instancePath"`
	SchemaPath   string         `json:"schemaPath"`
	Keyword      string         `json:"keyword"`
	Params       map[string]any `json:"params"`
	Message      string         `json:"message"`
}

func detail(path, schema, key, message string, params map[string]any) validationDetail {
	return validationDetail{path, schema + "/" + key, key, params, message}
}
func validationFailure(location string, details []validationDetail) error {
	messages := make([]string, len(details))
	for i, d := range details {
		messages[i] = location + d.InstancePath + " " + d.Message
	}
	return &fault.Error{Status: 400, Code: "VALIDATION_ERROR", Message: strings.Join(messages, ", "), Details: details}
}
func whitespace(r rune) bool {
	return r == ' ' || (r >= '\t' && r <= '\r') || r == '\u00a0' || r == '\u1680' || (r >= '\u2000' && r <= '\u200a') || r == '\u2028' || r == '\u2029' || r == '\u202f' || r == '\u205f' || r == '\u3000' || r == '\ufeff'
}
func coerce(value any, kind string) (any, bool) {
	if values, ok := value.([]any); ok && kind != "array" && len(values) == 1 {
		value = values[0]
	}
	switch kind {
	case "object":
		_, ok := value.(map[string]any)
		return value, ok
	case "array":
		switch value.(type) {
		case []any:
			return value, true
		case nil, string, bool, float64:
			return []any{value}, true
		}
		return value, false
	case "string":
		switch v := value.(type) {
		case string:
			return v, true
		case nil:
			return "", true
		case bool:
			return strconv.FormatBool(v), true
		case float64:
			return strconv.FormatFloat(v, 'f', -1, 64), true
		}
	case "boolean":
		switch v := value.(type) {
		case bool:
			return v, true
		case nil:
			return false, true
		case string:
			if v == "true" || v == "false" {
				return v == "true", true
			}
		case float64:
			if v == 0 || v == 1 {
				return v == 1, true
			}
		}
	case "integer":
		var n float64
		switch v := value.(type) {
		case float64:
			n = v
		case nil:
			n = 0
		case bool:
			if v {
				n = 1
			}
		case string:
			if v == "" {
				return value, false
			}
			var err error
			trim := strings.TrimFunc(v, whitespace)
			if trim == "" {
				n = 0
			} else {
				if strings.Contains(trim, "_") {
					return value, false
				}
				if len(trim) > 2 && trim[0] == '0' && strings.ContainsRune("xXoObB", rune(trim[1])) {
					var u uint64
					u, err = strconv.ParseUint(trim, 0, 64)
					n = float64(u)
				} else {
					n, err = strconv.ParseFloat(trim, 64)
				}
				if err != nil {
					return value, false
				}
			}
		default:
			return value, false
		}
		if !math.IsInf(n, 0) && !math.IsNaN(n) && math.Trunc(n) == n {
			return n, true
		}
	}
	return value, false
}
func validateRule(value any, rule *responseRule, path, schema string) (any, []validationDetail) {
	if len(rule.choices) > 0 {
		converted, ok := coerce(value, "string")
		for _, choice := range rule.choices {
			if ok && converted == choice {
				return converted, nil
			}
		}
		details := []validationDetail{}
		for i, choice := range rule.choices {
			branch := schema + "/anyOf/" + strconv.Itoa(i)
			if !ok {
				details = append(details, detail(path, branch, "type", "must be string", map[string]any{"type": "string"}))
			}
			details = append(details, detail(path, branch, "const", "must be equal to constant", map[string]any{"allowedValue": choice}))
		}
		return value, append(details, detail(path, schema, "anyOf", "must match a schema in anyOf", map[string]any{}))
	}
	converted, ok := coerce(value, rule.kind)
	one := func(key, message string, params map[string]any) (any, []validationDetail) {
		return value, []validationDetail{detail(path, schema, key, message, params)}
	}
	if !ok {
		return one("type", "must be "+rule.kind, map[string]any{"type": rule.kind})
	}
	switch rule.kind {
	case "object":
		values := converted.(map[string]any)
		if rule.preserve {
			return values, nil
		}
		for _, field := range rule.fields {
			if _, ok := values[field.name]; !ok && !rule.optional[field.name] {
				return one("required", "must have required property '"+field.name+"'", map[string]any{"missingProperty": field.name})
			}
		}
		result := map[string]any{}
		for _, field := range rule.fields {
			if _, ok := values[field.name]; !ok {
				continue
			}
			v, errors := validateRule(values[field.name], field.rule, path+"/"+field.name, schema+"/properties/"+field.name)
			if len(errors) > 0 {
				return value, errors
			}
			result[field.name] = v
		}
		return result, nil
	case "array":
		values := converted.([]any)
		if rule.bounded && len(values) > rule.max {
			return one("maxItems", fmt.Sprintf("must NOT have more than %d items", rule.max), map[string]any{"limit": rule.max})
		}
		if len(values) < rule.min {
			return one("minItems", fmt.Sprintf("must NOT have fewer than %d items", rule.min), map[string]any{"limit": rule.min})
		}
		for i, v := range values {
			v, errors := validateRule(v, rule.item, path+"/"+strconv.Itoa(i), schema+"/items")
			if len(errors) > 0 {
				return value, errors
			}
			values[i] = v
		}
		return values, nil
	case "string":
		text := converted.(string)
		length := utf8.RuneCountInString(text)
		if length > rule.max {
			return one("maxLength", fmt.Sprintf("must NOT have more than %d characters", rule.max), map[string]any{"limit": rule.max})
		}
		if length < rule.min {
			return one("minLength", fmt.Sprintf("must NOT have fewer than %d characters", rule.min), map[string]any{"limit": rule.min})
		}
		if rule.nonblank && strings.TrimFunc(text, whitespace) == "" {
			return one("pattern", `must match pattern "\S"`, map[string]any{"pattern": `\S`})
		}
	case "integer":
		n := converted.(float64)
		if rule.bounded && n > float64(rule.max) {
			return one("maximum", fmt.Sprintf("must be <= %d", rule.max), map[string]any{"comparison": "<=", "limit": rule.max})
		}
		if n < float64(rule.min) {
			return one("minimum", fmt.Sprintf("must be >= %d", rule.min), map[string]any{"comparison": ">=", "limit": rule.min})
		}
	}
	return converted, nil
}
func rawObject(value any) (map[string]json.RawMessage, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var object map[string]json.RawMessage
	err = json.Unmarshal(raw, &object)
	return object, err
}
func responseBody(r *http.Request, rule *responseRule) (map[string]json.RawMessage, error) {
	value, err := decodeBody(r)
	if err != nil {
		return nil, err
	}
	value, details := validateRule(value, rule, "", "#")
	if len(details) > 0 {
		return nil, validationFailure("body", details)
	}
	return rawObject(value)
}

type parameterTooLong struct{ path string }

func (e *parameterTooLong) Error() string { return "route parameter exceeds maximum length" }
func responseParams(r *http.Request, keys ...string) error {
	for _, key := range keys {
		value := r.PathValue(key)
		if utf8.RuneCountInString(value) > 100 {
			return &parameterTooLong{r.URL.EscapedPath()}
		}
		_, details := validateRule(value, textRule(1, 100), "/"+key, "#/properties/"+key)
		if len(details) > 0 {
			return validationFailure("params", details)
		}
	}
	return nil
}
