package httpapi

import (
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
	"strings"
)

func alertInput(r *http.Request, operator bool) (intake.AlertInput, error) {
	evidence := objectRule(responseField{"type", &responseRule{choices: []string{"entity", "ip", "domain", "file", "email", "url"}}}, responseField{"value", textRule(1, 2000)}, responseField{"label", textRule(0, 200)})
	evidence.optional = map[string]bool{"label": true}
	schema := objectRule(responseField{"external_id", textRule(1, 200)}, responseField{"title", textRule(1, 300)}, responseField{"severity", &responseRule{choices: []string{"low", "medium", "high", "critical"}}}, responseField{"summary", textRule(0, 4000)}, responseField{"category", textRule(0, 120)}, responseField{"alert_type", textRule(0, 120)}, responseField{"primary_entity", textRule(0, 500)}, responseField{"insight_refs", &responseRule{kind: "array", max: 50, bounded: true, item: textRule(0, 200)}}, responseField{"evidence", &responseRule{kind: "array", max: 50, bounded: true, item: evidence}})
	schema.optional = map[string]bool{}
	for _, f := range schema.fields {
		schema.optional[f.name] = f.name != "external_id" && f.name != "title" && f.name != "severity"
	}
	if operator {
		fields := []responseField{{"source", textRule(1, 120)}, schema.fields[0], {"rule_id", textRule(1, 100)}}
		schema.fields = append(fields, schema.fields[1:]...)
	}
	value, err := decodeBody(r)
	if err != nil {
		return intake.AlertInput{}, err
	}
	value, details := validateRule(value, schema, "", "#")
	if len(details) > 0 {
		return intake.AlertInput{}, validationFailure("body", details)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return intake.AlertInput{}, err
	}
	var input intake.AlertInput
	err = json.Unmarshal(raw, &input)
	return input, err
}
func registerIntake(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := intake.Store{Pool: pool}
	operator := respond(func(r *http.Request) (any, int, error) {
		input, err := alertInput(r, true)
		if err != nil {
			return nil, 0, err
		}
		result, err := store.IngestOperator(r.Context(), auth.From(r.Context()).Tenant, input)
		if err != nil {
			return nil, 0, err
		}
		status := 201
		if result["duplicate"] == true {
			status = 200
		}
		return result, status, nil
	})
	mux.HandleFunc("POST /api/v1/alerts", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 131072)
		operator(w, r)
	})
	for _, kind := range []string{"alerts", "events"} {
		handler := respond(func(r *http.Request) (any, int, error) {
			var input intake.AlertInput
			var native map[string]any
			var err error
			if kind == "alerts" {
				input, err = alertInput(r, false)
			} else {
				var v any
				v, err = decodeBody(r)
				if err == nil {
					var details []validationDetail
					v, details = validateRule(v, &responseRule{kind: "object", preserve: true}, "", "#")
					if len(details) > 0 {
						err = validationFailure("body", details)
					} else {
						native = v.(map[string]any)
					}
				}
			}
			if err != nil {
				return nil, 0, err
			}
			result, err := store.IngestSource(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), input, native)
			if err != nil {
				return nil, 0, err
			}
			status := 201
			if result["duplicate"] == true {
				status = 200
			}
			return result, status, nil
		})
		mux.HandleFunc("POST /api/v1/intake/{id}/"+kind, func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, 131072)
			handler(w, r)
		})
	}
	mux.HandleFunc("GET /api/v1/alerts/{id}", respond(func(r *http.Request) (any, int, error) {
		item, err := store.Alert(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return item, 200, err
	}))
	mux.HandleFunc("GET /api/v1/alerts", respond(func(r *http.Request) (any, int, error) {
		limit, offset := 100, 0
		var err error
		q := r.URL.Query()
		if q.Has("limit") {
			limit, err = strconv.Atoi(q.Get("limit"))
			if err != nil || limit < 1 || limit > 100 {
				return nil, 0, invalid()
			}
		}
		if q.Has("offset") {
			offset, err = strconv.Atoi(q.Get("offset"))
			if err != nil || offset < 0 {
				return nil, 0, invalid()
			}
		}
		items, err := store.Alerts(r.Context(), auth.From(r.Context()).Tenant, limit, offset)
		return map[string]any{"items": items}, 200, err
	}))
}
