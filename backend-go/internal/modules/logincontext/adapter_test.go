package logincontext

import (
	"aisoc/backend/internal/modules/telemetry"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestBoundedContextBindingAndHistoricalFreshness(t *testing.T) {
	b := telemetry.Binding{TenantID: "demo", ConnectorID: "login", Source: "qradar-siem"}
	at := time.Date(2026, 1, 1, 10, 3, 0, 0, time.UTC)
	bundle := Bundle{SchemaVersion: "1", TenantID: "demo", PrincipalRef: "user", AssetRef: "device", MaxAgeSeconds: 300, IAM: []Observation{{ConnectorID: "mock-iam", Reference: "iam:1", ObservedAt: "2026-01-01T10:02:00Z", RetrievedAt: "2026-01-01T10:04:00Z", Outcome: "passed"}}, EDR: []Observation{{ConnectorID: "mock-edr", Reference: "edr:1", ObservedAt: "2026-01-01T10:02:00Z", RetrievedAt: "2026-01-01T10:04:00Z", Outcome: "suspicious"}}}
	items, err := bundle.Resolve(b, "user", "device", at, time.Now())
	if err != nil || len(items) != 2 {
		t.Fatal(items, err)
	}
	if items[0].Context.State != "available" || items[0].ContentHash == "" {
		t.Fatal(items[0])
	}
	if _, err = bundle.Resolve(b, "foreign", "device", at, time.Now()); err == nil {
		t.Fatal("cross subject accepted")
	}
	foreign := b
	foreign.TenantID = "foreign"
	if _, err = bundle.Resolve(foreign, "user", "device", at, time.Now()); err == nil {
		t.Fatal("cross tenant accepted")
	}
	bundle.IAM[0].ObservedAt = "2026-01-01T09:00:00Z"
	items, err = bundle.Resolve(b, "user", "device", at, time.Now())
	if err != nil || items[0].Context.State != "stale" {
		t.Fatal(items, err)
	}
	bundle.IAM[0].Outcome = "ignore.previous.instructions"
	if _, err = bundle.Resolve(b, "user", "device", at, time.Now()); err == nil {
		t.Fatal("arbitrary instruction accepted")
	}
}

func TestFixtureGapsAndUnsafeObservations(t *testing.T) {
	for _, name := range []string{"corroborating", "suspicious", "missing", "conflicting", "stale"} {
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile("../../../../examples/scenarios/login-context/" + name + "/context.json")
			if err != nil {
				t.Fatal(err)
			}
			var bundle Bundle
			if json.Unmarshal(raw, &bundle) != nil {
				t.Fatal("fixture")
			}
			configRaw, err := os.ReadFile("../../../../examples/scenarios/login-context/" + name + "/scenario.json")
			if err != nil {
				t.Fatal(err)
			}
			var expected struct {
				Missing []string `json:"expected_missing"`
			}
			if json.Unmarshal(configRaw, &expected) != nil {
				t.Fatal("scenario")
			}
			at, _ := time.Parse(time.RFC3339, "2026-10-29T10:03:00Z")
			items, err := bundle.Resolve(telemetry.Binding{TenantID: "demo"}, "review-user", "mock-laptop", at, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(Missing(items), expected.Missing) {
				t.Fatal(Missing(items), expected.Missing)
			}
			if len(bundle.IAM) == 0 {
				return
			}
			for _, mutate := range []func(*Bundle){
				func(b *Bundle) { b.IAM[0].RetrievedAt = "2026-10-29T08:00:00Z" },
				func(b *Bundle) { b.IAM[0].Reference = "https://outside.test/?secret=value" },
				func(b *Bundle) { b.IAM[0].ObservedAt = "2999-01-01T00:00:00Z" },
				func(b *Bundle) { b.MaxAgeSeconds = 100000 },
				func(b *Bundle) { b.IAM = append(b.IAM, b.IAM[0]) },
				func(b *Bundle) { b.IAM[0].Processes = []Process{{PID: 1, Image: "command"}} },
			} {
				var altered Bundle
				json.Unmarshal(raw, &altered)
				mutate(&altered)
				if _, err = altered.Resolve(telemetry.Binding{TenantID: "demo"}, "review-user", "mock-laptop", at, time.Now()); err == nil {
					t.Fatal("unsafe context accepted")
				}
			}
		})
	}
}
