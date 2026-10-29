package httpapi

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/fault"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
)

func detectionSchema(partial bool) *responseRule {
	schedule := textRule(1, 120)
	schedule.nonblank = false
	rule := objectRule(
		responseField{"expected_version", versionRule}, responseField{"name", textRule(1, 200)}, responseField{"description", textRule(0, 4000)},
		responseField{"mitre_techniques", &responseRule{kind: "array", item: textRule(0, 1048576)}},
		responseField{"execution_mode", &responseRule{choices: []string{"scheduled", "realtime"}}}, responseField{"enabled", boolRule},
		responseField{"severity", &responseRule{choices: []string{"low", "medium", "high", "critical"}}}, responseField{"query", textRule(0, 20000)},
		responseField{"schedule", schedule}, responseField{"lookback_window", schedule}, responseField{"routing", &responseRule{choices: []string{"Investigate", "Sample (10%)", "Suppress", "Escalate"}}},
	)
	rule.optional = map[string]bool{}
	for _, field := range rule.fields {
		rule.optional[field.name] = partial || (field.name != "name" && field.name != "severity")
	}
	return rule
}
func detectionInput(r *http.Request, partial bool) (map[string]any, []string, int, error) {
	raw, keys, err := orderedBody(r)
	if err != nil {
		return nil, nil, 0, err
	}
	encoded, _ := json.Marshal(raw)
	var values any
	if err = json.Unmarshal(encoded, &values); err != nil {
		return nil, nil, 0, err
	}
	value, details := validateRule(values, detectionSchema(partial), "", "#")
	if len(details) > 0 {
		return nil, nil, 0, validationFailure("body", details)
	}
	input := value.(map[string]any)
	expected := 0
	if v, ok := input["expected_version"]; ok {
		rawVersion, _ := json.Marshal(v)
		expected, err = version(map[string]json.RawMessage{"expected_version": rawVersion})
		if err != nil {
			return nil, nil, 0, err
		}
	}
	filtered := []string{}
	for _, key := range keys {
		if _, ok := input[key]; ok {
			filtered = append(filtered, key)
		}
	}
	return input, filtered, expected, nil
}
func registerDetection(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := detection.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/detection-registry", respond(func(r *http.Request) (any, int, error) {
		options, err := registryInput(r)
		if err != nil {
			return nil, 0, err
		}
		result, err := store.Registry(r.Context(), auth.From(r.Context()).Tenant, options)
		return result, 200, err
	}))
	mux.HandleFunc("POST /api/v1/detection-rules", respond(func(r *http.Request) (any, int, error) {
		input, _, _, err := detectionInput(r, false)
		if err != nil {
			return nil, 0, err
		}
		result, err := store.Create(r.Context(), auth.From(r.Context()).Tenant, input)
		return result, 201, err
	}))
	mux.HandleFunc("GET /api/v1/detection-rules", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		limit, offset := 100, 0
		var err error
		if _, ok := q["limit"]; ok {
			limit, err = strconv.Atoi(q.Get("limit"))
			if err != nil || limit < 1 || limit > 500 {
				return nil, 0, invalid()
			}
		}
		if _, ok := q["offset"]; ok {
			offset, err = strconv.Atoi(q.Get("offset"))
			if err != nil || offset < 0 {
				return nil, 0, invalid()
			}
		}
		items, err := store.List(r.Context(), auth.From(r.Context()).Tenant, q.Get("search"), q.Get("severity"), limit, offset)
		return map[string]any{"items": items}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/detection-rules/{id}", respond(func(r *http.Request) (any, int, error) {
		result, err := store.Detail(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return result, 200, err
	}))
	mux.HandleFunc("GET /api/v1/detection-rules/{id}/history", respond(func(r *http.Request) (any, int, error) {
		result, err := store.History(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return map[string]any{"items": result}, 200, err
	}))
	mux.HandleFunc("PATCH /api/v1/detection-rules/{id}", respond(func(r *http.Request) (any, int, error) {
		input, keys, expected, err := detectionInput(r, true)
		if err != nil {
			return nil, 0, err
		}
		result, err := store.Update(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), input, keys, expected, false)
		return result, 200, err
	}))
	for _, operation := range []string{"clone", "toggle"} {
		mux.HandleFunc("POST /api/v1/detection-rules/{id}/"+operation, respond(func(r *http.Request) (any, int, error) {
			tenant, id := auth.From(r.Context()).Tenant, r.PathValue("id")
			var result map[string]any
			var err error
			status := 200
			if operation == "clone" {
				result, err = store.Clone(r.Context(), tenant, id)
				status = 201
			} else {
				result, err = store.Update(r.Context(), tenant, id, nil, nil, 0, true)
			}
			var missing *fault.Error
			if errors.As(err, &missing) && missing.Status == 404 {
				message := "detection rule not found"
				if operation == "clone" {
					message = "Detection rule not found"
				}
				err = fault.New(404, "NOT_FOUND", message)
			}
			return result, status, err
		}))
	}
	mux.HandleFunc("DELETE /api/v1/detection-rules/{id}", respond(func(r *http.Request) (any, int, error) {
		err := store.Delete(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return nil, 204, err
	}))
}
