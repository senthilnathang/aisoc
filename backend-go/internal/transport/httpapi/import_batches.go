package httpapi

import (
	"aisoc/backend/internal/modules/localintegrations"
	"aisoc/backend/internal/modules/localintegrations/localsql"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/fault"
	"net/http"
)

func registerImportBatches(mux *http.ServeMux, s localintegrations.Store, scopes []config.StreamScope) {
	// Scope resolution precedes every read/mutation. No tenant or grant is trusted from JSON.
	scope := func(r *http.Request, id string) error {
		a := auth.From(r.Context())
		b, e := localsql.New(s.Pool).GetImportBatch(r.Context(), localsql.GetImportBatchParams{TenantID: a.Tenant, ID: id})
		if e != nil {
			return fault.New(404, "IMPORT_BATCH_NOT_FOUND", "Local batch not found.")
		}
		_, e = buildGrant(scopes, a.Tenant, a.ID, b.ScopeID)
		return streamError(e)
	}
	mux.HandleFunc("GET /api/v1/build/import-batches", streamRespond(func(r *http.Request) (any, int, error) {
		a := auth.From(r.Context())
		rows, e := localsql.New(s.Pool).ListImportBatches(r.Context(), a.Tenant)
		if e != nil {
			return nil, 0, e
		}
		visible := []any{}
		for _, row := range rows {
			if _, e := buildGrant(scopes, a.Tenant, a.ID, row.ScopeID); e == nil {
				visible = append(visible, map[string]any{"id": row.ID, "scope_id": row.ScopeID, "name": row.Name, "actor": row.Actor, "created_at": row.CreatedAt})
			}
		}
		used, e := localsql.New(s.Pool).CountProfiles(r.Context(), a.Tenant)
		if e != nil {
			return nil, 0, e
		}
		batches, e := localsql.New(s.Pool).CountImportBatches(r.Context(), a.Tenant)
		return map[string]any{"items": visible, "quotas": map[string]any{"profiles_used": used, "profiles_limit": s.ProfileLimit(), "batches_used": batches, "batches_limit": s.BatchLimit(), "max_cases": localintegrations.MaxBatchCases, "max_bytes": localintegrations.MaxBatchBytes}}, 200, e
	}))
	for _, op := range []string{"preview", "save"} {
		op := op
		path := "POST /api/v1/build/import-batches"
		if op == "preview" {
			path += "/preview"
		}
		mux.HandleFunc(path, streamRespond(func(r *http.Request) (any, int, error) {
			var in localintegrations.BatchInput
			if e := streamBody(r, &in); e != nil {
				return nil, 0, streamError(e)
			}
			a := auth.From(r.Context())
			if _, e := buildGrant(scopes, a.Tenant, a.ID, in.ScopeID); e != nil {
				return nil, 0, streamError(e)
			}
			if op == "preview" {
				items, e := localintegrations.PreviewBatch(a.Tenant, in)
				return map[string]any{"items": items, "mode": "local/mock"}, 200, e
			}
			result, e := s.CreateBatch(r.Context(), a.Tenant, a.ID, in)
			return result, 200, e
		}))
	}
	mux.HandleFunc("GET /api/v1/build/import-batches/{id}", streamRespond(func(r *http.Request) (any, int, error) {
		if e := scope(r, r.PathValue("id")); e != nil {
			return nil, 0, e
		}
		result, e := s.Batch(r.Context(), auth.From(r.Context()).Tenant, r.PathValue("id"))
		return result, 200, e
	}))
	mux.HandleFunc("POST /api/v1/build/import-batches/{id}/process", streamRespond(func(r *http.Request) (any, int, error) {
		if e := scope(r, r.PathValue("id")); e != nil {
			return nil, 0, e
		}
		var in struct {
			Confirm  bool             `json:"confirm"`
			Expected map[string]int32 `json:"expected_versions"`
		}
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		if !in.Confirm || len(in.Expected) == 0 {
			return nil, 0, fault.New(400, "CONFIRM_REQUIRED", "Confirm local batch import. Successful cases keep immutable evidence.")
		}
		a := auth.From(r.Context())
		result, e := s.ProcessBatch(r.Context(), a.Tenant, a.ID, r.PathValue("id"), in.Expected)
		return result, 202, e
	}))
	mux.HandleFunc("PUT /api/v1/build/import-batches/{id}/cases/{key}", streamRespond(func(r *http.Request) (any, int, error) {
		if e := scope(r, r.PathValue("id")); e != nil {
			return nil, 0, e
		}
		var in struct {
			Expected int32                       `json:"expected_version"`
			Case     localintegrations.BatchCase `json:"case"`
		}
		if e := streamBody(r, &in); e != nil {
			return nil, 0, streamError(e)
		}
		a := auth.From(r.Context())
		result, e := s.RepairBatchCase(r.Context(), a.Tenant, a.ID, r.PathValue("id"), r.PathValue("key"), in.Expected, in.Case)
		return result, 200, e
	}))
}
