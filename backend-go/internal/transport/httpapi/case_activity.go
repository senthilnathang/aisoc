package httpapi

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/auth"
	"encoding/json"
	"net/http"
)

func registerCaseActivity(mux *http.ServeMux, store investigations.Store) {
	for _, kind := range []string{"artifacts", "feedback"} {
		mux.HandleFunc("POST /api/v1/investigations/{id}/"+kind, respond(func(r *http.Request) (any, int, error) {
			raw, err := body(r)
			if err != nil {
				return nil, 0, err
			}
			fields := map[string]any{}
			if kind == "feedback" {
				value, err := stringField(raw, "comment", 1, 4000)
				if err != nil {
					return nil, 0, err
				}
				fields["comment"] = value
			} else {
				typ, err := stringField(raw, "type", 1, 20)
				if err != nil {
					return nil, 0, err
				}
				switch typ {
				case "entity", "ip", "domain", "file", "email", "url":
				default:
					return nil, 0, invalid()
				}
				value, err := stringField(raw, "value", 1, 2000)
				if err != nil {
					return nil, 0, err
				}
				label := ""
				if _, exists := raw["label"]; exists {
					label, err = stringField(raw, "label", 0, 200)
					if err != nil {
						return nil, 0, err
					}
				}
				metadata := map[string]any{}
				if v, ok := raw["metadata"]; ok {
					if json.Unmarshal(v, &metadata) != nil || metadata == nil {
						return nil, 0, invalid()
					}
				}
				fields["type"] = typ
				fields["value"] = value
				fields["label"] = label
				fields["metadata"] = metadata
			}
			result, err := store.AddRecord(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), kind, fields)
			return result, 201, err
		}))
	}
	mux.HandleFunc("POST /api/v1/investigations/{id}/determination", respond(func(r *http.Request) (any, int, error) {
		raw, keys, err := orderedBody(r)
		if err != nil {
			return nil, 0, err
		}
		value, err := stringField(raw, "determination", 1, 50)
		if err != nil {
			return nil, 0, err
		}
		switch value {
		case "unknown", "benign", "suspicious", "malicious", "mitigated":
		default:
			return nil, 0, invalid()
		}
		raw["determination"], _ = json.Marshal(value)
		result, err := store.Patch(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"), raw, keys)
		return result, 200, err
	}))
	mux.HandleFunc("POST /api/v1/investigations/{id}/reinvestigate", respond(func(r *http.Request) (any, int, error) {
		result, err := store.Reinvestigate(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return result, 200, err
	}))
}
