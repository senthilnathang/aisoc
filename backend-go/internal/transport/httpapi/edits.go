package httpapi

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/response"
	"aisoc/backend/internal/platform/auth"
	"bytes"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"sort"
	"strconv"
)

// JSON object order is observable in legacy audit fields. Keep first insertion
// order for repeated keys, with JavaScript's integer property ordering.
func orderedBody(r *http.Request) (map[string]json.RawMessage, []string, error) {
	var copy bytes.Buffer
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.TeeReader(r.Body, &copy), r.Body}
	raw, err := body(r)
	if err != nil {
		return nil, nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(copy.Bytes()))
	if _, err = decoder.Token(); err != nil {
		return nil, nil, err
	}
	seen := map[string]bool{}
	keys := []string{}
	numbers := []string{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, nil, err
		}
		key := token.(string)
		var value json.RawMessage
		if err = decoder.Decode(&value); err != nil {
			return nil, nil, err
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		n, e := strconv.ParseUint(key, 10, 32)
		if e == nil && n < 4294967295 && strconv.FormatUint(n, 10) == key {
			numbers = append(numbers, key)
		} else {
			keys = append(keys, key)
		}
	}
	sort.Slice(numbers, func(i, j int) bool {
		a, _ := strconv.ParseUint(numbers[i], 10, 32)
		b, _ := strconv.ParseUint(numbers[j], 10, 32)
		return a < b
	})
	return raw, append(numbers, keys...), nil
}
func registerEdits(mux *http.ServeMux, pool *pgxpool.Pool) {
	cases := investigations.Store{Pool: pool}
	store := response.Store{Pool: pool}
	mux.HandleFunc("PATCH /api/v1/investigations/{id}", respond(func(r *http.Request) (any, int, error) {
		fields, keys, err := orderedBody(r)
		if err != nil {
			return nil, 0, err
		}
		result, err := cases.Patch(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), fields, keys)
		return result, 200, err
	}))
	mux.HandleFunc("POST /api/v1/remediations", respond(func(r *http.Request) (any, int, error) {
		raw, err := body(r)
		if err != nil {
			return nil, 0, err
		}
		for _, key := range []string{"investigation_id", "action_type", "title", "description", "connector"} {
			_, exists := raw[key]
			if !exists && (key == "description" || key == "connector") {
				continue
			}
			value, err := stringField(raw, key, 0, 1048576)
			if err != nil {
				return nil, 0, err
			}
			if value == "" && key != "description" && key != "connector" {
				return nil, 0, invalid()
			}
			raw[key], _ = json.Marshal(value)
		}
		result, err := store.CreateRemediation(r.Context(), auth.From(r.Context()).Tenant, raw)
		return result, 201, err
	}))
	mux.HandleFunc("GET /api/v1/remediations", respond(func(r *http.Request) (any, int, error) {
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
		result, err := investigations.RemediationRecords(r.Context(), pool, auth.From(r.Context()).Tenant, q.Get("investigationId"), q.Get("status"), q.Get("search"), limit, offset)
		return map[string]any{"items": result}, 200, err
	}))
	mux.HandleFunc("GET /api/v1/remediations/{id}", respond(func(r *http.Request) (any, int, error) {
		result, err := store.Remediation(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return result, 200, err
	}))
	for _, action := range []struct{ pattern, operation string }{{"PATCH /api/v1/remediations/{id}", "patch"}, {"DELETE /api/v1/remediations/{id}", "delete"}, {"POST /api/v1/remediations/{id}/execute", "execute"}} {
		mux.HandleFunc(action.pattern, respond(func(r *http.Request) (any, int, error) {
			var raw map[string]json.RawMessage
			var keys []string
			var err error
			if action.operation == "patch" {
				raw, keys, err = orderedBody(r)
				if err != nil {
					return nil, 0, err
				}
			}
			result, err := store.MutateRemediation(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), action.operation, raw, keys)
			status := 200
			if action.operation == "delete" {
				status = 204
			}
			return result, status, err
		}))
	}
}
