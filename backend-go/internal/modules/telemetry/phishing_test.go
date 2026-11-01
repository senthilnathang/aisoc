package telemetry

import (
	"fmt"
	"testing"
	"time"
)

func phishingEvents(t *testing.T) []Event {
	_, base := fixture(t)
	events := []Event{}
	for i, kind := range []string{"email.delivered", "email.authentication_failed", "email.link_clicked", "email.credential_submitted"} {
		e := base
		e.EventType = kind
		e.SourceEventID = fmt.Sprintf("mail-%d", i)
		e.EventID = e.SourceEventID
		e.EventTime = fmt.Sprintf("2026-10-29T10:0%d:00Z", i)
		e.EvidenceRef = "mock-email:" + e.SourceEventID
		e.Projection.MessageRef = "message-1"
		events = append(events, e)
	}
	return events
}
func TestPhishingCorrelationAndIsolation(t *testing.T) {
	events := phishingEvents(t)
	now := time.Date(2026, 10, 29, 10, 5, 0, 0, time.UTC)
	found, err := Phishing(sandbox, events, now)
	if err != nil || len(found) != 1 {
		t.Fatalf("finding: %+v %v", found, err)
	}
	if found[0].Kind != "credential_phishing" || len(found[0].EvidenceRefs) != 4 {
		t.Fatal(found)
	}
	replay := append([]Event{events[3], events[1], events[0], events[2]}, events[0])
	again, err := Phishing(sandbox, replay, now)
	if err != nil || len(again) != 1 || again[0].FindingID != found[0].FindingID {
		t.Fatal("replay/order changed finding", err)
	}
	for _, tc := range []string{"message", "principal", "asset", "ip", "late", "order", "missing"} {
		t.Run(tc, func(t *testing.T) {
			e := append([]Event(nil), events...)
			switch tc {
			case "message":
				e[2].Projection.MessageRef = "other"
			case "principal":
				e[2].Projection.PrincipalRef = "other"
			case "asset":
				e[2].Projection.AssetRef = "other"
			case "ip":
				e[2].Projection.SourceIP = "192.0.2.99"
			case "late":
				e[0].EventTime = "2026-10-29T09:50:00Z"
			case "order":
				e[2].EventTime = e[3].EventTime
			case "missing":
				e = e[:3]
			}
			f, err := Phishing(sandbox, e, now)
			if err != nil || len(f) != 0 {
				t.Fatal("unrelated/incomplete observations correlated", f, err)
			}
		})
	}
	e := append([]Event(nil), events...)
	e[0].TenantID = "foreign"
	if _, err := Phishing(sandbox, e, now); err == nil {
		t.Fatal("foreign tenant")
	}
	e = append([]Event(nil), events...)
	e[0].Projection.MessageRef = ""
	if e[0].Validate(sandbox) == nil {
		t.Fatal("missing message allowed")
	}
	e = append([]Event(nil), events...)
	e[0].EventType = "authentication.failed"
	if e[0].Validate(sandbox) == nil {
		t.Fatal("login carried message")
	}
	e = append([]Event(nil), events...)
	e = append(e, e[0])
	e[4].Projection.MessageRef = "conflict"
	if _, err := Phishing(sandbox, e, now); err == nil {
		t.Fatal("conflicting delivery")
	}
	e = append([]Event(nil), events...)
	e = append(e, e[0])
	e[4].SourceRevision = "2"
	if _, err := Phishing(sandbox, e, now); err != ErrRevisionAmbiguous {
		t.Fatal("ambiguous revision", err)
	}
}
