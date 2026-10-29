package qradarmock

import (
	"aisoc/backend/internal/modules/telemetry"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCorrelation(t *testing.T) {
	b := telemetry.Binding{TenantID: "tenant-a", ConnectorID: "mock", Source: "qradar-siem"}
	events, err := LoginPage(b)
	if err != nil {
		t.Fatal(err)
	}
	watermark := time.Date(2026, 10, 29, 10, 4, 0, 0, time.UTC)
	want, err := telemetry.SuspiciousLogins(b, events, watermark)
	if err != nil || len(want) != 1 {
		t.Fatal(want, err)
	}
	if err = want[0].ValidateEvidence(b, events); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 4; n++ {
		shuffled := append(append([]telemetry.Event{}, events[n:]...), events[:n]...)
		shuffled = append(shuffled, events...)
		got, err := telemetry.SuspiciousLogins(b, shuffled, watermark)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatal("unstable replay", err)
		}
	}
	for _, tc := range []struct {
		name   string
		change func([]telemetry.Event)
		count  int
		fail   bool
	}{
		{"principal", func(e []telemetry.Event) { e[1].Projection.PrincipalRef = "other" }, 0, false},
		{"asset", func(e []telemetry.Event) { e[1].Projection.AssetRef = "other" }, 0, false},
		{"IP", func(e []telemetry.Event) { e[1].Projection.SourceIP = "192.0.2.11" }, 0, false},
		{"canonical IP", func(e []telemetry.Event) { e[1].Projection.SourceIP = "::ffff:192.0.2.10" }, 1, false},
		{"after success", func(e []telemetry.Event) { e[1].EventTime = "2026-10-29T10:03:01Z" }, 0, false},
		{"equal time", func(e []telemetry.Event) { e[1].EventTime = e[0].EventTime }, 0, false},
		{"outside window", func(e []telemetry.Event) { e[1].EventTime = "2026-10-29T09:57:59Z" }, 0, false},
		{"window boundary", func(e []telemetry.Event) { e[1].EventTime = "2026-10-29T09:58:00Z" }, 1, false},
		{"tenant", func(e []telemetry.Event) { e[1].TenantID = "other" }, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := append([]telemetry.Event(nil), events...)
			tc.change(e)
			got, err := telemetry.SuspiciousLogins(b, e, watermark)
			if (err != nil) != tc.fail || len(got) != tc.count {
				t.Fatal(got, err)
			}
		})
	}
	got, err := telemetry.SuspiciousLogins(b, events, watermark.Add(-2*time.Minute))
	if err != nil || len(got) != 0 {
		t.Fatal(got, err)
	}
	revised := events[1]
	revised.SourceRevision = "updated"
	if _, err = telemetry.SuspiciousLogins(b, append(events, revised), watermark); !errors.Is(err, telemetry.ErrRevisionAmbiguous) {
		t.Fatal(err)
	}
	revised = events[1]
	revised.Projection.AssetRef = "changed"
	if _, err = telemetry.SuspiciousLogins(b, append(events, revised), watermark); !errors.Is(err, telemetry.ErrInvalid) {
		t.Fatal(err)
	}
	if _, err = telemetry.SuspiciousLogins(b, make([]telemetry.Event, 101), watermark); err == nil {
		t.Fatal("unbounded input")
	}
	if _, err = LoginPage(telemetry.Binding{Source: "qradar-soar"}); err == nil {
		t.Fatal("SOAR telemetry")
	}
}

func TestSOARLifecycle(t *testing.T) {
	first := CaseRevision{Binding: telemetry.Binding{TenantID: "tenant-a", ConnectorID: "mock", Source: "qradar-soar"}, ExternalID: "case-1", Version: "z", Status: "open"}
	current, changed, err := ApplyCase(nil, first)
	if err != nil || !changed {
		t.Fatal(err)
	}
	_, changed, err = ApplyCase(&current, first)
	if err != nil || changed {
		t.Fatal("duplicate", err)
	}
	closed := current
	closed.Version = "a"
	closed.PreviousVersion = current.Version
	closed.Status = "closed"
	current, changed, err = ApplyCase(&current, closed)
	if err != nil || !changed {
		t.Fatal("opaque revision", err)
	}
	reopened := current
	reopened.Version = "r"
	reopened.PreviousVersion = current.Version
	reopened.Status = "reopened"
	current, changed, err = ApplyCase(&current, reopened)
	if err != nil || !changed {
		t.Fatal("reopen", err)
	}
	if _, _, err = ApplyCase(&current, closed); !errors.Is(err, ErrCaseConflict) {
		t.Fatal("stale", err)
	}
	conflict := current
	conflict.Status = "closed"
	if _, _, err = ApplyCase(&current, conflict); !errors.Is(err, ErrCaseConflict) {
		t.Fatal("conflict", err)
	}
	foreign := current
	foreign.Binding.TenantID = "other"
	if _, _, err = ApplyCase(&current, foreign); !errors.Is(err, telemetry.ErrBinding) {
		t.Fatal(err)
	}
	if _, _, err = ApplyCase(nil, reopened); err == nil {
		t.Fatal("no history")
	}
}
