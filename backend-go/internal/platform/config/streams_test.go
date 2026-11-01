package config

import (
	"aisoc/backend/internal/modules/logincontext"
	"testing"
)

func TestStreamScopeGrants(t *testing.T) {
	s := StreamScope{ID: "mock", OperatorID: "local-development", TenantID: "demo", ConnectorID: "mock-qradar", Source: "qradar-siem", Processor: "login-v1", AllowMockImport: true}
	a := Auth{Mode: "local", StreamOperations: []StreamScope{s}}
	if err := a.Validate(true); err == nil || err.Error() != "mock stream import is disabled in production" {
		t.Fatal("production mock import must fail closed", err)
	}
	if err := validateStreamScopes(a); err != nil {
		t.Fatal(err)
	}
	a.Mode = "token"
	if err := validateStreamScopes(a); err == nil {
		t.Fatal("unknown token operator granted")
	}
	a.Operators = []Operator{{ID: s.OperatorID, TenantID: s.TenantID}}
	if err := validateStreamScopes(a); err != nil {
		t.Fatal(err)
	}
	a.StreamOperations = append(a.StreamOperations, s)
	if err := validateStreamScopes(a); err == nil {
		t.Fatal("duplicate scope")
	}
}

func TestConflictingMockReviewGrants(t *testing.T) {
	s := StreamScope{ID: "review", OperatorID: "local-development", TenantID: "demo", ConnectorID: "mock-review", Source: "qradar-siem", Processor: "mock-login-v1", AllowMockImport: true, RequireAnalystReview: true}
	a := Auth{Mode: "local", StreamOperations: []StreamScope{s}}
	if err := validateStreamScopes(a); err != nil {
		t.Fatal(err)
	}
	s.ID = "weaker"
	s.Processor = "other-login-v1"
	s.RequireAnalystReview = false
	a.StreamOperations = append(a.StreamOperations, s)
	if err := validateStreamScopes(a); err == nil {
		t.Fatal("conflicting worker gates accepted")
	}
}

func TestContextGrantsCannotDisagreeAcrossProcessors(t *testing.T) {
	bundle := &logincontext.Bundle{SchemaVersion: "1", TenantID: "demo", PrincipalRef: "user", AssetRef: "device", MaxAgeSeconds: 300}
	s := StreamScope{ID: "context", OperatorID: "local-development", TenantID: "demo", ConnectorID: "login", Source: "qradar-siem", Processor: "first", AllowMockImport: true, RequireAnalystReview: true, MockLoginContext: bundle}
	a := Auth{Mode: "local", StreamOperations: []StreamScope{s}}
	if err := validateStreamScopes(a); err != nil {
		t.Fatal(err)
	}
	s.ID = "second"
	s.Processor = "second"
	s.MockLoginContext = nil
	a.StreamOperations = append(a.StreamOperations, s)
	if validateStreamScopes(a) == nil {
		t.Fatal("conflicting context accepted")
	}
	a.StreamOperations = a.StreamOperations[:1]
	a.StreamOperations[0].RequireAnalystReview = false
	if validateStreamScopes(a) == nil {
		t.Fatal("context without approval accepted")
	}
}
