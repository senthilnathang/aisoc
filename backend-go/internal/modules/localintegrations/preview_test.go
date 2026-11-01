package localintegrations

import (
	"aisoc/backend/internal/modules/telemetry"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestPreviewUsesAuthorizedBindingAndRejectsForeignEvidence(t *testing.T) {
	raw, err := os.ReadFile("../../../../examples/scenarios/suspicious-login/events.json")
	if err != nil {
		t.Fatal(err)
	}
	var d Document
	d.SchemaVersion = "1"
	json.Unmarshal(raw, &d.Events)
	b := telemetry.Binding{TenantID: "demo", ConnectorID: "build-test", Source: "qradar-siem"}
	p, err := Preview(d, b, time.Now())
	if err != nil || len(p.Events) != 4 || len(p.Findings) != 1 {
		t.Fatal(p, err)
	}
	if p.Events[0].ConnectorID != "build-test" {
		t.Fatal("untrusted connector used")
	}
	d.Events[0].TenantID = "foreign"
	if _, err = Preview(d, b, time.Now()); err == nil {
		t.Fatal("foreign tenant accepted")
	}
	d.Events[0].TenantID = "demo"
	d.Events = append(d.Events, d.Events[0])
	if _, err = Preview(d, b, time.Now()); err == nil {
		t.Fatal("extra/duplicate evidence accepted")
	}
}

func TestPreviewRejectsReferencesThatCannotBecomeAWorkerTask(t *testing.T) {
	raw, err := os.ReadFile("../../../../examples/scenarios/login-context/corroborating/events.json")
	if err != nil {
		t.Fatal(err)
	}
	contextRaw, err := os.ReadFile("../../../../examples/scenarios/login-context/corroborating/context.json")
	if err != nil {
		t.Fatal(err)
	}
	d := Document{SchemaVersion: "1"}
	json.Unmarshal(raw, &d.Events)
	json.Unmarshal(contextRaw, &d.Context)
	b := telemetry.Binding{TenantID: "demo", ConnectorID: "build-test", Source: "qradar-siem"}
	d.Context.IAM[0].Reference = d.Events[0].EvidenceRef
	if _, err = Preview(d, b, time.Now()); err == nil {
		t.Fatal("context/login reference collision accepted")
	}
	d.Context = nil
	d.Events[1].EvidenceRef = d.Events[0].EvidenceRef
	if _, err = Preview(d, b, time.Now()); err == nil {
		t.Fatal("login reference collision accepted")
	}
}
