package telemetry

import (
	"bytes"
	"encoding/json"
	"sort"
	"time"
)

func DecodeFinding(raw []byte, binding Binding, events []Event) (Finding, error) {
	var finding Finding
	if len(raw) == 0 || len(raw) > MaxEnvelopeBytes || uniqueJSON(raw) != nil {
		return finding, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&finding); err != nil {
		return Finding{}, ErrInvalid
	}
	if err := finding.ValidateEvidence(binding, events); err != nil {
		return Finding{}, err
	}
	return finding, nil
}

// Finding is a candidate for investigation, never an authorized response.
type Finding struct {
	SchemaVersion string   `json:"schema_version"`
	FindingID     string   `json:"finding_id"`
	TenantID      string   `json:"tenant_id"`
	ConnectorID   string   `json:"connector_id"`
	Source        string   `json:"source"`
	RuleID        string   `json:"rule_id"`
	RuleVersion   string   `json:"rule_version"`
	Kind          string   `json:"kind"`
	Disposition   string   `json:"disposition"`
	ObservedFrom  string   `json:"observed_from"`
	ObservedUntil string   `json:"observed_until"`
	EventKeys     []string `json:"event_keys"`
	EvidenceRefs  []string `json:"evidence_refs"`
}

func (f Finding) Identity() string {
	keys := append([]string(nil), f.EventKeys...)
	sort.Strings(keys)
	return digest([]any{f.TenantID, f.ConnectorID, f.Source, f.RuleID, f.RuleVersion, f.Kind, keys})
}

// ValidateEvidence verifies provenance against the bounded events provided by Go.
// It does not evaluate a detection rule or establish a security verdict.
func (f Finding) ValidateEvidence(binding Binding, events []Event) error {
	if f.TenantID != binding.TenantID || f.ConnectorID != binding.ConnectorID || f.Source != binding.Source {
		return ErrBinding
	}
	if f.SchemaVersion != "1.0" || f.Kind != "suspicious_login" || f.Disposition != "requires_review" || !identifier.MatchString(f.RuleID) || !identifier.MatchString(f.RuleVersion) {
		return ErrInvalid
	}
	if len(events) < 2 || len(events) > 64 || len(f.EventKeys) != len(events) || len(f.EvidenceRefs) == 0 || len(f.EvidenceRefs) > 64 {
		return ErrInvalid
	}
	if !utc(f.ObservedFrom) || !utc(f.ObservedUntil) {
		return ErrInvalid
	}
	start, _ := time.Parse(time.RFC3339Nano, f.ObservedFrom)
	end, _ := time.Parse(time.RFC3339Nano, f.ObservedUntil)
	if end.Before(start) {
		return ErrInvalid
	}
	keys := map[string]bool{}
	refs := map[string]bool{}
	for _, e := range events {
		if err := e.Validate(binding); err != nil {
			return err
		}
		if keys[e.Identity()] {
			return ErrInvalid
		}
		t, _ := time.Parse(time.RFC3339Nano, e.EventTime)
		if t.Before(start) || t.After(end) {
			return ErrInvalid
		}
		keys[e.Identity()] = true
		refs[e.EvidenceRef] = true
	}
	for _, key := range f.EventKeys {
		if !keys[key] {
			return ErrInvalid
		}
		delete(keys, key)
	}
	for _, ref := range f.EvidenceRefs {
		if !refs[ref] {
			return ErrInvalid
		}
		delete(refs, ref)
	}
	if len(refs) != 0 || f.FindingID != f.Identity() {
		return ErrInvalid
	}
	return nil
}
