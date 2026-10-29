package httpapi

import (
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/platform/auth"
	"bytes"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
)

func mappingInput(r *http.Request, preview bool) (intake.Mapping, []string, map[string]any, error) {
	var captured bytes.Buffer
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.TeeReader(r.Body, &captured), r.Body}
	value, err := decodeBody(r)
	if err != nil {
		return intake.Mapping{}, nil, nil, err
	}
	var root, rawMapping map[string]json.RawMessage
	_ = json.Unmarshal(captured.Bytes(), &root)
	_ = json.Unmarshal(root["mapping"], &rawMapping)
	fieldKeys, severityKeys := intake.Keys(rawMapping["fields"]), intake.Keys(rawMapping["severity_map"])
	dict := func(keys []string, item *responseRule) *responseRule {
		fields := []responseField{}
		for _, key := range keys {
			fields = append(fields, responseField{key, item})
		}
		return objectRule(fields...)
	}
	mappingRule := objectRule(responseField{"fields", dict(fieldKeys, textRule(0, 1048576))}, responseField{"severity_map", dict(severityKeys, &responseRule{choices: []string{"low", "medium", "high", "critical"}})})
	mappingRule.optional = map[string]bool{"severity_map": true}
	fields := []responseField{{"mapping", mappingRule}}
	if preview {
		fields = append(fields, responseField{"sample", &responseRule{kind: "object", preserve: true}})
	}
	validated, details := validateRule(value, objectRule(fields...), "", "#")
	if len(details) > 0 {
		return intake.Mapping{}, nil, nil, validationFailure("body", details)
	}
	data := validated.(map[string]any)
	m, issues := intake.CheckMapping(data["mapping"].(map[string]any), fieldKeys, severityKeys)
	sample, _ := data["sample"].(map[string]any)
	return m, issues, sample, nil
}
func registerSourceMapping(mux *http.ServeMux, pool *pgxpool.Pool) {
	store := intake.Store{Pool: pool}
	mux.HandleFunc("PATCH /api/v1/api-sources/{id}/mapping", respond(func(r *http.Request) (any, int, error) {
		m, issues, _, err := mappingInput(r, false)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		result, err := store.SaveMapping(r.Context(), p.Tenant, r.PathValue("id"), m, issues, p.ID)
		return result, 200, err
	}))
	preview := respond(func(r *http.Request) (any, int, error) {
		m, issues, sample, err := mappingInput(r, true)
		if err != nil {
			return nil, 0, err
		}
		p := auth.From(r.Context())
		source, err := store.Get(r.Context(), p.Tenant, r.PathValue("id"))
		if err != nil {
			return nil, 0, err
		}
		if len(issues) > 0 {
			return map[string]any{"valid": false, "errors": issues, "normalized_alert": nil}, 200, nil
		}
		return m.Preview(source["source"].(string), source["rule_id"].(string), sample), 200, nil
	})
	mux.HandleFunc("POST /api/v1/api-sources/{id}/mapping/preview", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 131072)
		preview(w, r)
	})
}
