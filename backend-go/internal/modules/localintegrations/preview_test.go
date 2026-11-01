package localintegrations

import (
	"aisoc/backend/internal/modules/telemetry"
	"encoding/json"
	"fmt"
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

func TestPreviewAcceptsBoundedExtendedLoginWindow(t *testing.T) {
	raw, err := os.ReadFile("../../../../examples/scenarios/suspicious-login/events.json")
	if err != nil {
		t.Fatal(err)
	}
	d := Document{SchemaVersion: "1"}
	if err = json.Unmarshal(raw, &d.Events); err != nil {
		t.Fatal(err)
	}
	extra := d.Events[1]
	extra.EventID = "extended-failure"
	extra.SourceEventID = "extended-failure"
	extra.EvidenceRef = "qradar://events/extended-failure"
	d.Events = append(d.Events, extra)
	p, err := Preview(d, Binding("demo", "build-test"), time.Now())
	if err != nil || len(p.Events) != 5 || len(p.Findings) != 1 {
		t.Fatalf("extended login window: %+v %v", p, err)
	}
}

func TestExtendedWindowRejectsUnrelatedAndOverBudgetObservations(t *testing.T) {
	raw, err := os.ReadFile("../../../../examples/scenarios/suspicious-login/events.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"other_identity", "outside_window", "too_many"} {
		t.Run(kind, func(t *testing.T) {
			d := Document{SchemaVersion: "1"}
			if err := json.Unmarshal(raw, &d.Events); err != nil {
				t.Fatal(err)
			}
			e := d.Events[1]
			e.EventID = "additional"
			e.SourceEventID = "additional"
			e.EvidenceRef = "mock:additional"
			switch kind {
			case "other_identity":
				e.Projection.PrincipalRef = "other-user"
			case "outside_window":
				e.EventTime = "2026-10-29T09:00:00Z"
			case "too_many":
				for i := 0; i < 9; i++ {
					copy := e
					copy.EventID = fmt.Sprintf("extra-%d", i)
					copy.SourceEventID = copy.EventID
					copy.EvidenceRef = "mock:" + copy.EventID
					d.Events = append(d.Events, copy)
				}
			}
			if kind != "too_many" {
				d.Events = append(d.Events, e)
			}
			if _, err := Preview(d, Binding("demo", "build-test"), time.Now()); err == nil {
				t.Fatal("unsafe extended window accepted")
			}
		})
	}
}
