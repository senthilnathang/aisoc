package httpapi

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/response"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"math"
	"net/http"
	"strconv"
	"strings"
)

func respond(fn func(*http.Request) (any, int, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, status, err := fn(r)
		if err != nil {
			fail(w, err)
			return
		}
		if status == 204 {
			w.WriteHeader(status)
			return
		}
		write(w, status, value)
	}
}

func registerQueue(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := investigations.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/investigation-queue", respond(func(r *http.Request) (any, int, error) {
		result, err := store.Queue(r.Context(), auth.From(r.Context()).Tenant)
		return result, 200, err
	}))
}
func integer(data json.RawMessage, min, max int) (int, error) {
	var scalar any
	if json.Unmarshal(data, &scalar) != nil {
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
	case nil:
		n = 0
	default:
		return 0, invalid()
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n || n < float64(min) || n > float64(max) {
		return 0, invalid()
	}
	return int(n), nil
}
func caseInput(raw map[string]json.RawMessage) (investigations.Input, error) {
	in := investigations.Input{Category: "other", Status: "open", Determination: "unknown", Owner: "AISOC Agent", InsightRefs: []string{}}
	var err error
	for _, f := range []struct {
		key      string
		target   *string
		required bool
	}{{"title", &in.Title, true}, {"source", &in.Source, true}, {"summary", &in.Summary, false}, {"category", &in.Category, false}, {"severity", &in.Severity, true}, {"status", &in.Status, false}, {"determination", &in.Determination, false}, {"owner", &in.Owner, false}, {"primary_entity", &in.PrimaryEntity, false}} {
		if _, exists := raw[f.key]; !exists && !f.required {
			continue
		}
		if *f.target, err = stringField(raw, f.key, 0, 1048576); err != nil {
			return in, err
		}
		if f.required && *f.target == "" {
			return in, invalid()
		}
	}
	if value, ok := raw["risk_score"]; ok {
		if in.RiskScore, err = integer(value, 0, 100); err != nil {
			return in, err
		}
	}
	if value, ok := raw["insight_refs"]; ok {
		var refs []json.RawMessage
		if string(value) == "null" || json.Unmarshal(value, &refs) != nil || len(refs) > 50 {
			return in, invalid()
		}
		for _, ref := range refs {
			s, err := stringField(map[string]json.RawMessage{"value": ref}, "value", 0, 200)
			if err != nil {
				return in, err
			}
			in.InsightRefs = append(in.InsightRefs, s)
		}
	}
	return in, nil
}
func registerCases(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := investigations.Store{Pool: pool}
	plans := response.Store{Pool: pool}
	registerCaseActivity(mux, store)
	registerEdits(mux, pool)
	mux.HandleFunc("POST /api/v1/investigations", respond(func(r *http.Request) (any, int, error) {
		raw, err := body(r)
		if err != nil {
			return nil, 0, err
		}
		in, err := caseInput(raw)
		if err != nil {
			return nil, 0, err
		}
		result, err := store.Create(r.Context(), auth.From(r.Context()).Tenant, in)
		return result, 201, err
	}))
	mux.HandleFunc("GET /api/v1/investigations", respond(func(r *http.Request) (any, int, error) {
		q := r.URL.Query()
		o := investigations.ListOptions{Search: q.Get("search"), Status: q.Get("status"), Severity: q.Get("severity"), Limit: 100}
		var err error
		if _, ok := q["limit"]; ok {
			o.Limit, err = strconv.Atoi(q.Get("limit"))
			if err != nil || o.Limit < 1 || o.Limit > 500 {
				return nil, 0, invalid()
			}
		}
		if _, ok := q["offset"]; ok {
			o.Offset, err = strconv.Atoi(q.Get("offset"))
			if err != nil || o.Offset < 0 {
				return nil, 0, invalid()
			}
		}
		result, err := store.List(r.Context(), auth.From(r.Context()).Tenant, o)
		return map[string]any{"items": result}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/investigations/{id}", respond(func(r *http.Request) (any, int, error) {
		result, err := store.Detail(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return result, 200, err
	}))
	mux.HandleFunc("GET /api/v1/investigations/{id}/history", respond(func(r *http.Request) (any, int, error) {
		result, err := store.History(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return map[string]any{"items": result}, 200, err
	}))
	mux.HandleFunc("DELETE /api/v1/investigations/{id}", respond(func(r *http.Request) (any, int, error) {
		err := store.Delete(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return nil, 204, err
	}))
	runbook := func(pattern string, fn func(*http.Request) (any, int, error)) {
		mux.HandleFunc(pattern, respond(func(r *http.Request) (any, int, error) {
			keys := []string{"id"}
			if r.PathValue("assignmentId") != "" {
				keys = append(keys, "assignmentId")
			}
			if err := responseParams(r, keys...); err != nil {
				return nil, 0, err
			}
			return fn(r)
		}))
	}
	runbook("GET /api/v1/investigations/{id}/runbooks", func(r *http.Request) (any, int, error) {
		result, err := plans.Assignments(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return map[string]any{"items": result}, 200, err
	})
	runbook("POST /api/v1/investigations/{id}/runbooks", func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, attachRule)
		if err != nil {
			return nil, 0, err
		}
		planID, err := stringField(raw, "plan_id", 1, 100)
		if err != nil {
			return nil, 0, err
		}
		v, err := version(raw)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := plans.Attach(r.Context(), p.Tenant, r.PathValue("id"), planID, v, p.ID)
		return result, 201, err
	})
	runbook("PATCH /api/v1/investigations/{id}/runbooks/{assignmentId}", func(r *http.Request) (any, int, error) {
		raw, err := responseBody(r, updateStepRule)
		if err != nil {
			return nil, 0, err
		}
		var in response.StepInput
		if in.ExpectedVersion, err = version(raw); err != nil {
			return nil, 0, err
		}
		if in.StepIndex, err = integer(raw["step_index"], 0, 49); err != nil {
			return nil, 0, err
		}
		if in.Note, err = stringField(raw, "note", 0, 4000); err != nil {
			return nil, 0, err
		}
		if in.Completed, err = boolean(raw["completed"]); err != nil {
			return nil, 0, err
		}
		if in.ApprovalConfirmed, err = boolean(raw["approval_confirmed"]); err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := plans.Step(r.Context(), p.Tenant, r.PathValue("id"), r.PathValue("assignmentId"), in, p.ID)
		return result, 200, err
	})
}
