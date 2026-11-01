package config

import (
	"aisoc/backend/internal/modules/logincontext"
	"aisoc/backend/internal/modules/telemetry"
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

type StreamScope struct {
	MockLoginContext     *logincontext.Bundle `json:"mock_login_context,omitempty"`
	MaxHotEvents         int64                `json:"max_hot_events,omitempty"`
	ID                   string               `json:"id"`
	OperatorID           string               `json:"operator_id"`
	TenantID             string               `json:"tenant_id"`
	ConnectorID          string               `json:"connector_id"`
	Source               string               `json:"source"`
	Processor            string               `json:"processor"`
	AllowRetry           bool                 `json:"allow_retry"`
	RequireAnalystReview bool                 `json:"require_analyst_review,omitempty"`
	AllowMockImport      bool                 `json:"allow_mock_import"`
	AllowSandboxResponse bool                 `json:"allow_sandbox_response"`
	PendingWarning       int64                `json:"pending_warning"`
	AgeWarningSeconds    int64                `json:"age_warning_seconds"`
}

func (s StreamScope) HotEventLimit() int64 {
	if s.MaxHotEvents == 0 {
		return 1000
	}
	return s.MaxHotEvents
}

func validateStreamScopes(a Auth) error {
	if len(a.StreamOperations) > 100 {
		return errors.New("too many stream scopes")
	}
	id := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	seen := map[string]bool{}
	policies := map[string]string{}
	for _, s := range a.StreamOperations {
		if s.MaxHotEvents != 0 && (s.MaxHotEvents < 100 || s.MaxHotEvents > 10000) {
			return errors.New("hot event limit must be 100..10000")
		}
		if !id.MatchString(s.ID) || !id.MatchString(s.OperatorID) || !id.MatchString(s.TenantID) || !id.MatchString(s.ConnectorID) || !id.MatchString(s.Source) || !id.MatchString(s.Processor) || seen[s.ID] || s.PendingWarning < 0 || s.PendingWarning > 100000 || s.AgeWarningSeconds < 0 || s.AgeWarningSeconds > 86400 {
			return errors.New("invalid stream operations scope")
		}
		if s.MockLoginContext != nil {
			if !s.AllowMockImport || !s.RequireAnalystReview {
				return errors.New("login context requires reviewed mock intake")
			}
			if _, err := s.MockLoginContext.Resolve(telemetry.Binding{TenantID: s.TenantID}, s.MockLoginContext.PrincipalRef, s.MockLoginContext.AssetRef, time.Now(), time.Now()); err != nil {
				return err
			}
		}
		if s.AllowMockImport {
			policy, _ := json.Marshal(struct {
				Review  bool
				Context *logincontext.Bundle
			}{s.RequireAnalystReview, s.MockLoginContext})
			key := s.TenantID + ":" + s.ConnectorID + ":" + s.Source
			if prior, ok := policies[key]; ok && prior != string(policy) {
				return errors.New("conflicting analyst review requirements for source")
			}
			policies[key] = string(policy)
		}
		seen[s.ID] = true
		found := a.Mode == "local" && s.OperatorID == "local-development"
		for _, op := range a.Operators {
			if op.ID == s.OperatorID && op.TenantID == s.TenantID {
				found = true
			}
		}
		if !found {
			return errors.New("stream grant has no matching operator")
		}
		if s.AllowMockImport && s.Source != "qradar-siem" {
			return errors.New("mock import requires qradar-siem source")
		}
	}
	return nil
}

// AllowsBuildProfile grants only bounded local fixture management under an
// existing reviewed source. It never inherits sandbox/provider action permission.
func (s StreamScope) AllowsBuildProfile() bool {
	return s.AllowMockImport && s.RequireAnalystReview && !s.AllowSandboxResponse && s.Source == "qradar-siem"
}
