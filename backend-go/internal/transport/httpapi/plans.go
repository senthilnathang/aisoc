package httpapi

import (
	"aisoc/backend/internal/modules/response"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/fault"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func fail(w http.ResponseWriter, err error) {
	var parameter *parameterTooLong
	if errors.As(err, &parameter) {
		write(w, 414, map[string]any{"error": "Bad Request", "code": "FST_ERR_MAX_PARAM_LENGTH", "message": "'" + parameter.path + "' is exceeding the max param length", "statusCode": 414})
		return
	}
	var f *fault.Error
	if errors.As(err, &f) {
		write(w, f.Status, map[string]any{"error": map[string]any{"code": f.Code, "message": f.Message, "details": f.Details}})
		return
	}
	write(w, 500, map[string]any{"error": map[string]any{"code": "INTERNAL_ERROR", "message": "Internal server error", "details": nil}})
}
func invalid() error {
	return fault.New(400, "VALIDATION_ERROR", "Request does not match the response plan schema.")
}
func body(r *http.Request) (map[string]json.RawMessage, error) {
	value, err := decodeBody(r)
	if err != nil {
		return nil, err
	}
	if _, ok := value.(map[string]any); !ok {
		return nil, invalid()
	}
	return rawObject(value)
}
func decodeBody(r *http.Request) (any, error) {
	media, _, parseErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if parseErr != nil || (media != "application/json" && media != "text/plain") {
		return nil, fault.New(415, "INVALID_REQUEST", "Unsupported Media Type")
	}
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			return nil, fault.New(413, "PAYLOAD_TOO_LARGE", "Request body is too large")
		}
		return nil, err
	}
	if media == "text/plain" {
		return string(data), nil
	}
	if len(data) == 0 {
		return nil, fault.New(400, "INVALID_REQUEST", "Body cannot be empty when content-type is set to 'application/json'")
	}
	var raw any
	if json.Unmarshal(data, &raw) != nil || forbiddenJSONProperty(raw) {
		return nil, fault.New(400, "INVALID_REQUEST", "Body is not valid JSON but content-type is set to 'application/json'")
	}
	return raw, nil
}

// Match the legacy JSON parser's rejection of prototype-related properties,
// including nested objects. These keys are harmless to Go but rejected by Node.
func forbiddenJSONProperty(value any) bool {
	switch v := value.(type) {
	case map[string]any:
		if _, exists := v["__proto__"]; exists {
			return true
		}
		if ctor, ok := v["constructor"].(map[string]any); ok {
			if _, exists := ctor["prototype"]; exists {
				return true
			}
		}
		for _, child := range v {
			if forbiddenJSONProperty(child) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if forbiddenJSONProperty(child) {
				return true
			}
		}
	}
	return false
}
func stringField(raw map[string]json.RawMessage, key string, min, max int) (string, error) {
	var value string
	data, ok := raw[key]
	if !ok {
		return "", invalid()
	}
	var scalar any
	if json.Unmarshal(data, &scalar) != nil {
		return "", invalid()
	}
	switch v := scalar.(type) {
	case string:
		value = v
	case nil:
		value = ""
	case bool:
		value = strconv.FormatBool(v)
	case float64:
		value = strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return "", invalid()
	}
	if utf8.RuneCountInString(value) > max || (min > 0 && strings.TrimFunc(value, whitespace) == "") {
		return "", invalid()
	}
	return value, nil
}
func version(raw map[string]json.RawMessage) (int, error) {
	var scalar any
	if json.Unmarshal(raw["expected_version"], &scalar) != nil {
		return 0, invalid()
	}
	var n float64
	switch v := scalar.(type) {
	case float64:
		n = v
	case string:
		var err error
		n, err = strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			return 0, invalid()
		}
	case bool:
		if v {
			n = 1
		}
	default:
		return 0, invalid()
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 1 || math.Trunc(n) != n || n >= float64(math.MaxInt64) {
		return 0, invalid()
	}
	return int(n), nil
}

// Match the legacy Fastify/Ajv scalar coercion for boolean body properties.
func boolean(data json.RawMessage) (bool, error) {
	var scalar any
	if json.Unmarshal(data, &scalar) != nil {
		return false, invalid()
	}
	switch v := scalar.(type) {
	case bool:
		return v, nil
	case nil:
		return false, nil
	case string:
		if v == "true" {
			return true, nil
		}
		if v == "false" {
			return false, nil
		}
	case float64:
		if v == 1 {
			return true, nil
		}
		if v == 0 {
			return false, nil
		}
	}
	return false, invalid()
}
func input(raw map[string]json.RawMessage) (response.Input, error) {
	var p response.Input
	var err error
	if p.Kind, err = stringField(raw, "kind", 1, 20); err != nil {
		return p, err
	}
	if p.Kind != "runbook" && p.Kind != "workflow" {
		return p, invalid()
	}
	for _, field := range []struct {
		key      string
		target   *string
		min, max int
	}{{"title", &p.Title, 1, 200}, {"description", &p.Description, 0, 4000}, {"domain", &p.Domain, 1, 100}, {"trigger", &p.Trigger, 1, 500}} {
		if *field.target, err = stringField(raw, field.key, field.min, field.max); err != nil {
			return p, err
		}
	}
	var steps []map[string]json.RawMessage
	if json.Unmarshal(raw["steps"], &steps) != nil || len(steps) < 1 || len(steps) > 50 {
		return p, invalid()
	}
	p.Steps = make([]response.Step, 0, len(steps))
	for _, rawStep := range steps {
		var step response.Step
		if step.Title, err = stringField(rawStep, "title", 1, 300); err != nil {
			return p, err
		}
		if step.Instructions, err = stringField(rawStep, "instructions", 0, 4000); err != nil {
			return p, err
		}
		approval, ok := rawStep["approval_required"]
		if !ok {
			return p, invalid()
		}
		if step.ApprovalRequired, err = boolean(approval); err != nil {
			return p, err
		}
		p.Steps = append(p.Steps, step)
	}
	return p, nil
}
func registerPlans(mux *http.ServeMux, store response.Store) {
	handle := func(pattern string, fn func(*http.Request) (any, int, error)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			if id != "" {
				if err := responseParams(r, "id"); err != nil {
					fail(w, err)
					return
				}
			}
			data, status, err := fn(r)
			if err != nil {
				fail(w, err)
				return
			}
			write(w, status, data)
		})
	}
	handle("GET /api/v1/response-plans", func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		items, err := store.List(r.Context(), p.Tenant)
		return map[string]any{"items": items}, 200, err
	})
	handle("POST /api/v1/response-plans", func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, planRule(false))
		if err != nil {
			return nil, 0, err
		}
		in, err := input(raw)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := store.Create(r.Context(), p.Tenant, in, p.ID)
		return result, 201, err
	})
	handle("GET /api/v1/response-plans/{id}", func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		result, err := store.Get(r.Context(), p.Tenant, r.PathValue("id"))
		return result, 200, err
	})
	handle("GET /api/v1/response-plans/{id}/history", func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		items, err := store.History(r.Context(), p.Tenant, r.PathValue("id"))
		return map[string]any{"items": items}, 200, err
	})
	handle("PATCH /api/v1/response-plans/{id}", func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, planRule(true))
		if err != nil {
			return nil, 0, err
		}
		in, err := input(raw)
		if err != nil {
			return nil, 0, err
		}
		v, err := version(raw)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := store.Update(r.Context(), p.Tenant, r.PathValue("id"), v, in, p.ID)
		return result, 200, err
	})
	handle("POST /api/v1/response-plans/{id}/state", func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, stateRule)
		if err != nil {
			return nil, 0, err
		}
		v, err := version(raw)
		if err != nil {
			return nil, 0, err
		}
		state, err := stringField(raw, "state", 1, 20)
		if err != nil {
			return nil, 0, err
		}
		if state != "active" && state != "archived" {
			return nil, 0, invalid()
		}
		p := auth.From(r.Context())
		result, err := store.State(r.Context(), p.Tenant, r.PathValue("id"), v, state, p.ID)
		return result, 200, err
	})
	handle("POST /api/v1/response-plans/{id}/duplicate", func(r *http.Request) (any, int, error) {
		p := auth.From(r.Context())
		result, err := store.Duplicate(r.Context(), p.Tenant, r.PathValue("id"), p.ID)
		return result, 201, err
	})
}
