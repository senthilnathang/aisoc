package httpapi

import (
	"aisoc/backend/internal/modules/localintegrations"
	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/fault"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"time"
)

func buildGrant(scopes []config.StreamScope, tenant, actor, id string) (config.StreamScope, error) {
	for _, s := range scopes {
		if s.ID == id && s.TenantID == tenant && s.OperatorID == actor && s.AllowsBuildProfile() {
			return s, nil
		}
	}
	return config.StreamScope{}, eventstate.ErrRecoveryDenied
}
func profileScope(r *http.Request, pool *pgxpool.Pool, scopes []config.StreamScope, id string) (config.StreamScope, error) {
	actor := auth.From(r.Context())
	p, err := (localintegrations.Store{Pool: pool}).Get(r.Context(), actor.Tenant, id)
	if err != nil {
		return config.StreamScope{}, err
	}
	s, err := buildGrant(scopes, actor.Tenant, actor.ID, p.ScopeID)
	if err != nil {
		return s, err
	}
	s.ID = id
	s.ConnectorID = id
	s.Processor = "build-login-v1"
	s.AllowRetry = false
	s.AllowMockImport = false
	s.MockLoginContext = p.Document.Context
	s.MaxHotEvents = 1000
	return s, nil
}
func registerLocalIntegrations(mux *http.ServeMux, pool *pgxpool.Pool, scopes []config.StreamScope) {
	store := localintegrations.Store{Pool: pool}
	mux.HandleFunc("GET /api/v1/build/integrations", streamRespond(func(r *http.Request) (any, int, error) {
		a := auth.From(r.Context())
		items, err := store.List(r.Context(), a.Tenant)
		if err != nil {
			return nil, 0, err
		}
		visible := []localintegrations.Profile{}
		grants := []map[string]string{}
		for _, s := range scopes {
			if _, err := buildGrant(scopes, a.Tenant, a.ID, s.ID); err == nil {
				grants = append(grants, map[string]string{"id": s.ID, "source": s.Source})
			}
		}
		for _, p := range items {
			if _, err := buildGrant(scopes, a.Tenant, a.ID, p.ScopeID); err == nil {
				visible = append(visible, p)
			}
		}
		return map[string]any{"items": visible, "scopes": grants, "mode": "local-json-mock-v1", "limit": 20}, 200, nil
	}))
	mux.HandleFunc("GET /api/v1/build/integrations/example", streamRespond(func(r *http.Request) (any, int, error) {
		a := auth.From(r.Context())
		s, err := buildGrant(scopes, a.Tenant, a.ID, r.URL.Query().Get("scope_id"))
		if err != nil {
			return nil, 0, streamError(err)
		}
		events, err := qradarmock.LoginPage(telemetry.Binding{TenantID: a.Tenant, ConnectorID: s.ConnectorID, Source: s.Source})
		if err != nil {
			return nil, 0, err
		}
		if s.MockLoginContext != nil {
			for i := range events {
				events[i].Projection.PrincipalRef = s.MockLoginContext.PrincipalRef
				events[i].Projection.AssetRef = s.MockLoginContext.AssetRef
			}
		}
		return localintegrations.Document{SchemaVersion: "1", Events: events, Context: s.MockLoginContext}, 200, nil
	}))
	mux.HandleFunc("POST /api/v1/build/integrations/preview", streamRespond(func(r *http.Request) (any, int, error) {
		var body struct {
			ScopeID  string                     `json:"scope_id"`
			ID       string                     `json:"id"`
			Document localintegrations.Document `json:"document"`
		}
		if err := streamBody(r, &body); err != nil {
			return nil, 0, streamError(err)
		}
		a := auth.From(r.Context())
		if _, err := buildGrant(scopes, a.Tenant, a.ID, body.ScopeID); err != nil {
			return nil, 0, streamError(err)
		}
		if !localintegrations.ValidID(body.ID) {
			return nil, 0, localintegrations.Invalid()
		}
		// Preview binds to an isolated profile identity; it does not read another profile.
		preview, err := localintegrations.Preview(body.Document, localintegrations.Binding(a.Tenant, body.ID), time.Now())
		return preview, 200, err
	}))
	mux.HandleFunc("PUT /api/v1/build/integrations/{id}", streamRespond(func(r *http.Request) (any, int, error) {
		var body struct {
			ScopeID  string                     `json:"scope_id"`
			Name     string                     `json:"name"`
			Version  int32                      `json:"expected_version"`
			Document localintegrations.Document `json:"document"`
		}
		if err := streamBody(r, &body); err != nil {
			return nil, 0, streamError(err)
		}
		a := auth.From(r.Context())
		if _, err := buildGrant(scopes, a.Tenant, a.ID, body.ScopeID); err != nil {
			return nil, 0, streamError(err)
		}
		for _, configured := range scopes {
			if configured.TenantID == a.Tenant && (configured.ID == r.PathValue("id") || configured.ConnectorID == r.PathValue("id")) {
				return nil, 0, localintegrations.Conflict()
			}
		}
		p, err := store.Save(r.Context(), a.Tenant, a.ID, r.PathValue("id"), body.ScopeID, body.Name, body.Version, body.Document)
		return p, 200, err
	}))
	mux.HandleFunc("GET /api/v1/build/integrations/{id}", streamRespond(func(r *http.Request) (any, int, error) {
		s, err := profileScope(r, pool, scopes, r.PathValue("id"))
		if err != nil {
			return nil, 0, streamError(err)
		}
		p, err := store.Get(r.Context(), s.TenantID, s.ID)
		if err != nil {
			return nil, 0, err
		}
		worker, cases, err := streamStatus(r.Context(), pool, localintegrations.Binding(s.TenantID, s.ID), s.Processor)
		if err != nil {
			return nil, 0, err
		}
		history, err := store.History(r.Context(), s.TenantID, s.ID)
		if err != nil {
			return nil, 0, err
		}
		intake, err := store.IntakeStatus(r.Context(), s.TenantID, s.ID)
		return map[string]any{"profile": p, "worker": worker, "cases": cases, "revisions": history, "intake": intake}, 200, err
	}))
	mux.HandleFunc("POST /api/v1/build/integrations/{id}/archive", streamRespond(func(r *http.Request) (any, int, error) {
		var body struct {
			Version int32 `json:"expected_version"`
			Confirm bool  `json:"confirm"`
		}
		if err := streamBody(r, &body); err != nil {
			return nil, 0, streamError(err)
		}
		if !body.Confirm {
			return nil, 0, fault.New(400, "CONFIRM_REQUIRED", "Confirm archive; retained cases and evidence are preserved.")
		}
		s, err := profileScope(r, pool, scopes, r.PathValue("id"))
		if err != nil {
			return nil, 0, streamError(err)
		}
		a := auth.From(r.Context())
		p, err := store.Archive(r.Context(), a.Tenant, a.ID, s.ID, body.Version)
		return p, 200, err
	}))
	mux.HandleFunc("POST /api/v1/build/integrations/{id}/clone", streamRespond(func(r *http.Request) (any, int, error) {
		var body struct {
			Version int32  `json:"expected_version"`
			ID      string `json:"id"`
			Name    string `json:"name"`
		}
		if err := streamBody(r, &body); err != nil {
			return nil, 0, streamError(err)
		}
		s, err := profileScope(r, pool, scopes, r.PathValue("id"))
		if err != nil {
			return nil, 0, streamError(err)
		}
		a := auth.From(r.Context())
		for _, configured := range scopes {
			if configured.TenantID == a.Tenant && (configured.ID == body.ID || configured.ConnectorID == body.ID) {
				return nil, 0, localintegrations.Conflict()
			}
		}
		p, err := store.Clone(r.Context(), a.Tenant, a.ID, s.ID, body.Version, body.ID, body.Name)
		return p, 200, err
	}))
	mux.HandleFunc("POST /api/v1/build/integrations/{id}/import", streamRespond(func(r *http.Request) (any, int, error) {
		var body struct {
			Version int32 `json:"expected_version"`
			Confirm bool  `json:"confirm"`
		}
		if err := streamBody(r, &body); err != nil {
			return nil, 0, streamError(err)
		}
		if !body.Confirm {
			return nil, 0, fault.New(400, "CONFIRM_REQUIRED", "Confirm local import; this freezes the evidence snapshot.")
		}
		s, err := profileScope(r, pool, scopes, r.PathValue("id"))
		if err != nil {
			return nil, 0, streamError(err)
		}
		a := auth.From(r.Context())
		existing, err := store.Get(r.Context(), a.Tenant, s.ID)
		if err != nil {
			return nil, 0, err
		}
		p, err := store.Seal(r.Context(), a.Tenant, a.ID, s.ID, existing.ScopeID, body.Version)
		if err != nil {
			return nil, 0, err
		}
		b := localintegrations.Binding(a.Tenant, s.ID)
		preview, err := localintegrations.Preview(p.Document, b, time.Now())
		if err != nil {
			return nil, 0, err
		}
		intake := eventstate.Store{Pool: pool, MaxEvents: 1000, MaxPayloadBytes: 16 << 20}
		cp, err := intake.Checkpoint(r.Context(), b)
		if err != nil {
			return nil, 0, err
		}
		accepted, err := intake.Accept(r.Context(), b, cp, "build-profile-v1", preview.Events)
		return map[string]any{"accepted": accepted, "replayed": accepted.Inserted == 0, "state": "sealed", "mode": "local-json-mock-v1"}, 202, streamError(err)
	}))
}
