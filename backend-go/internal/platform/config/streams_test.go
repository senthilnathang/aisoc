package config

import "testing"

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
