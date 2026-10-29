// Package qradarmock contains synthetic fixtures, not IBM API payload adapters.
// It has no network access, credentials, response execution or durable case store.
package qradarmock

import (
	"aisoc/backend/internal/modules/telemetry"
	"errors"
	"regexp"
	"time"
)

var ErrCaseConflict = errors.New("mock SOAR revision conflict")
var token = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// CaseRevision uses an explicit mock predecessor, not an assumed vendor API field.
// Versions are opaque tokens. SOAR and SIEM identities remain separate.
type CaseRevision struct {
	Binding                                      telemetry.Binding
	ExternalID, Version, PreviousVersion, Status string
}

// ApplyCase is pure. Durable case persistence/write-back belong to later phases.
func ApplyCase(current *CaseRevision, next CaseRevision) (CaseRevision, bool, error) {
	for _, s := range []string{next.Binding.TenantID, next.Binding.ConnectorID, next.ExternalID, next.Version} {
		if !token.MatchString(s) {
			return CaseRevision{}, false, telemetry.ErrInvalid
		}
	}
	if next.Binding.Source != "qradar-soar" || (next.Status != "open" && next.Status != "closed" && next.Status != "reopened") {
		return CaseRevision{}, false, telemetry.ErrInvalid
	}
	if current == nil {
		if next.PreviousVersion != "" || next.Status == "reopened" {
			return CaseRevision{}, false, ErrCaseConflict
		}
		return next, true, nil
	}
	if current.Binding != next.Binding || current.ExternalID != next.ExternalID {
		return CaseRevision{}, false, telemetry.ErrBinding
	}
	if *current == next {
		return *current, false, nil
	}
	if next.Version == current.Version || next.PreviousVersion != current.Version || (next.Status == "reopened" && current.Status != "closed") || (current.Status == "closed" && next.Status == "open") {
		return CaseRevision{}, false, ErrCaseConflict
	}
	return next, true, nil
}

// LoginPage returns intentionally out-of-order synthetic SIEM observations.
func LoginPage(binding telemetry.Binding) ([]telemetry.Event, error) {
	if binding.Source != "qradar-siem" {
		return nil, telemetry.ErrBinding
	}
	base := time.Date(2026, 10, 29, 10, 0, 0, 0, time.UTC)
	events := make([]telemetry.Event, 0, 4)
	for _, i := range []int{3, 0, 2, 1} {
		id := []string{"failure-a", "failure-b", "failure-c", "success-a"}[i]
		kind := "authentication.failed"
		if i == 3 {
			kind = "authentication.succeeded"
		}
		e := telemetry.Event{SchemaVersion: "1.0", EventID: id, TenantID: binding.TenantID, ConnectorID: binding.ConnectorID, Source: binding.Source, SourceEventID: id, SourceRevision: "original", EventType: kind, EventTime: base.Add(time.Duration(i) * time.Minute).Format(time.RFC3339), IngestedAt: base.Add(4 * time.Minute).Format(time.RFC3339), Severity: "medium", EvidenceRef: "mock-siem:" + id, TraceID: "mock-trace", Projection: telemetry.Projection{PrincipalRef: "mock-user", AssetRef: "mock-device", SourceIP: "192.0.2.10"}}
		if err := e.Validate(binding); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}
