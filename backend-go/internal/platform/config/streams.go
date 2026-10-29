package config

import (
	"errors"
	"regexp"
)

type StreamScope struct {
	ID                string `json:"id"`
	OperatorID        string `json:"operator_id"`
	TenantID          string `json:"tenant_id"`
	ConnectorID       string `json:"connector_id"`
	Source            string `json:"source"`
	Processor         string `json:"processor"`
	AllowRetry        bool   `json:"allow_retry"`
	AllowMockImport   bool   `json:"allow_mock_import"`
	PendingWarning    int64  `json:"pending_warning"`
	AgeWarningSeconds int64  `json:"age_warning_seconds"`
}

func validateStreamScopes(a Auth) error {
	if len(a.StreamOperations) > 100 {
		return errors.New("too many stream scopes")
	}
	id := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	seen := map[string]bool{}
	for _, s := range a.StreamOperations {
		if !id.MatchString(s.ID) || !id.MatchString(s.OperatorID) || !id.MatchString(s.TenantID) || !id.MatchString(s.ConnectorID) || !id.MatchString(s.Source) || !id.MatchString(s.Processor) || seen[s.ID] || s.PendingWarning < 0 || s.PendingWarning > 100000 || s.AgeWarningSeconds < 0 || s.AgeWarningSeconds > 86400 {
			return errors.New("invalid stream operations scope")
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
