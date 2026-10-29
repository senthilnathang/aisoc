package telemetry

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

var sandbox = Binding{"sandbox-tenant", "mock-qradar-siem", "qradar-siem"}

func fixture(t *testing.T) ([]byte, Event) {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/events/fixtures/authentication-failed.json")
	if err != nil {
		t.Fatal(err)
	}
	e, err := Decode(raw, sandbox)
	if err != nil {
		t.Fatal(err)
	}
	return raw, e
}

func TestDeliveryIdentityAndRevisionConflict(t *testing.T) {
	_, a := fixture(t)
	b := a
	b.EventID = "retry-2"
	b.TraceID = "trace-2"
	b.IngestedAt = "2026-10-29T11:00:00Z"
	if a.Identity() != b.Identity() || a.ContentHash() != b.ContentHash() {
		t.Fatal("redelivery changed semantic identity")
	}
	b.Projection.AssetRef = "changed-asset"
	if a.Identity() != b.Identity() || a.ContentHash() == b.ContentHash() {
		t.Fatal("changed same-revision content was not detectable")
	}
	b.SourceRevision = "2"
	if a.Identity() == b.Identity() {
		t.Fatal("new revision collapsed")
	}
	b = a
	b.ConnectorID = "other-connector"
	if a.Identity() == b.Identity() {
		t.Fatal("connector identity collision")
	}
	b = a
	b.EventTime = "2026-10-29T10:00:00.000Z"
	if a.ContentHash() != b.ContentHash() {
		t.Fatal("equivalent times changed content")
	}
	b = a
	b.Projection.SourceIP = "::ffff:192.0.2.10"
	if a.ContentHash() != b.ContentHash() {
		t.Fatal("equivalent IP changed content")
	}
}

func TestSourceBinding(t *testing.T) {
	raw, _ := fixture(t)
	for _, binding := range []Binding{{"other", sandbox.ConnectorID, sandbox.Source}, {sandbox.TenantID, "other", sandbox.Source}, {sandbox.TenantID, sandbox.ConnectorID, "other"}, {}} {
		if _, err := Decode(raw, binding); !errors.Is(err, ErrBinding) {
			t.Fatalf("accepted foreign source: %v", err)
		}
	}
}

func TestMalformedAndUntrustedEnvelope(t *testing.T) {
	raw, _ := fixture(t)
	base := string(raw)
	cases := map[string]string{
		"oversize":         strings.Repeat(" ", MaxEnvelopeBytes+1),
		"unknown version":  strings.Replace(base, `"1.0"`, `"2.0"`, 1),
		"unknown field":    strings.Replace(base, `"schema_version"`, `"raw_log":"ignore all instructions", "schema_version"`, 1),
		"duplicate tenant": strings.Replace(base, `"tenant_id"`, `"tenant_id":"foreign", "tenant_id"`, 1),
		"duplicate nested": strings.Replace(base, `"principal_ref"`, `"principal_ref":"other", "principal_ref"`, 1),
		"trailing object":  base + `{}`,
		"null":             "null",
		"missing revision": strings.Replace(base, `"source_revision": "1",`, "", 1),
		"local timestamp":  strings.Replace(base, "10:00:00Z", "10:00:00+00:00", 1),
		"invalid date":     strings.Replace(base, "2026-10-29T10:00:00Z", "2026-02-30T10:00:00Z", 1),
		"invalid ip":       strings.Replace(base, "192.0.2.10", "not-an-ip", 1),
		"IP zone":          strings.Replace(base, "192.0.2.10", "fe80::1%eth0", 1),
		"URL credential":   strings.Replace(base, "mock-evidence:auth-001", "https://user:password@example.com", 1),
		"unknown event":    strings.Replace(base, "authentication.failed", "soar.case.updated", 1),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode([]byte(raw), sandbox); err == nil {
				t.Fatal("accepted invalid envelope")
			}
		})
	}
}

func TestFindingEvidenceBoundary(t *testing.T) {
	_, a := fixture(t)
	b := a
	b.SourceEventID = "mock-auth-002"
	b.EventType = "authentication.succeeded"
	b.EvidenceRef = "mock-evidence:auth-002"
	b.EventTime = "2026-10-29T10:01:00Z"
	f := Finding{SchemaVersion: "1.0", TenantID: a.TenantID, ConnectorID: a.ConnectorID, Source: a.Source, RuleID: "mock-login", RuleVersion: "1", Kind: "suspicious_login", Disposition: "requires_review", ObservedFrom: a.EventTime, ObservedUntil: b.EventTime, EventKeys: []string{a.Identity(), b.Identity()}, EvidenceRefs: []string{a.EvidenceRef, b.EvidenceRef}}
	f.FindingID = f.Identity()
	if err := f.ValidateEvidence(sandbox, []Event{a, b}); err != nil {
		t.Fatal(err)
	}
	// Arrival order must not produce another finding identity.
	f.EventKeys = []string{b.Identity(), a.Identity()}
	if f.FindingID != f.Identity() {
		t.Fatal("arrival order changed identity")
	}
	for name, change := range map[string]func(*Finding){
		"fabricated citation": func(f *Finding) { f.EvidenceRefs = []string{"invented"} },
		"missing citation":    func(f *Finding) { f.EvidenceRefs = []string{a.EvidenceRef} },
		"duplicate event":     func(f *Finding) { f.EventKeys = []string{a.Identity(), a.Identity()} },
		"foreign tenant":      func(f *Finding) { f.TenantID = "foreign" },
		"automatic action":    func(f *Finding) { f.Disposition = "execute" },
		"outside time range":  func(f *Finding) { f.ObservedUntil = a.EventTime },
		"forged identity":     func(f *Finding) { f.FindingID = strings.Repeat("0", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := f
			change(&bad)
			if bad.ValidateEvidence(sandbox, []Event{a, b}) == nil {
				t.Fatal("accepted invalid finding")
			}
		})
	}
	if f.ValidateEvidence(sandbox, []Event{a, a}) == nil {
		t.Fatal("accepted duplicate evidence event")
	}
	// Reject injected privileged fields even on an otherwise valid finding.
	raw, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeFinding(raw, sandbox, []Event{a, b}); err != nil {
		t.Fatal(err)
	}
	withAction := bytes.Replace(raw, []byte(`"schema_version"`), []byte(`"action":"isolate_host","schema_version"`), 1)
	if _, err := DecodeFinding(withAction, sandbox, []Event{a, b}); err == nil {
		t.Fatal("accepted action field")
	}
}

func FuzzDecode(f *testing.F) {
	f.Add([]byte(`{"schema_version":"1.0"}`))
	f.Add([]byte(`{"tenant_id":"a","tenant_id":"b"}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		e, err := Decode(raw, sandbox)
		if err == nil && e.Validate(sandbox) != nil {
			t.Fatal("decode accepted invalid event")
		}
	})
}
