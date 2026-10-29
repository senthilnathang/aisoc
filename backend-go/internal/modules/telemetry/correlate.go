package telemetry

import (
	"errors"
	"net/netip"
	"sort"
	"time"
)

var ErrRevisionAmbiguous = errors.New("multiple source revisions require an authoritative snapshot")

// SuspiciousLogins evaluates a bounded authoritative snapshot, never arrival order.
// Three distinct failures strictly precede success within five minutes for the same
// principal, asset and canonical IP. watermark is caller-owned event-time completeness.
func SuspiciousLogins(binding Binding, events []Event, watermark time.Time) ([]Finding, error) {
	if len(events) > 100 || watermark.IsZero() {
		return nil, ErrInvalid
	}
	unique := map[string]Event{}
	sources := map[string]string{}
	for _, e := range events {
		if err := e.Validate(binding); err != nil {
			return nil, err
		}
		k := e.Identity()
		if old, ok := unique[k]; ok && old.ContentHash() != e.ContentHash() {
			return nil, ErrInvalid
		}
		if revision, ok := sources[e.SourceEventID]; ok && revision != k {
			return nil, ErrRevisionAmbiguous
		}
		sources[e.SourceEventID] = k
		unique[k] = e
	}
	ordered := make([]Event, 0, len(unique))
	for _, e := range unique {
		ordered = append(ordered, e)
	}
	sort.Slice(ordered, func(i, j int) bool {
		a, _ := time.Parse(time.RFC3339Nano, ordered[i].EventTime)
		b, _ := time.Parse(time.RFC3339Nano, ordered[j].EventTime)
		if a.Equal(b) {
			return ordered[i].Identity() < ordered[j].Identity()
		}
		return a.Before(b)
	})
	same := func(a, b Event) bool {
		x, _ := netip.ParseAddr(a.Projection.SourceIP)
		y, _ := netip.ParseAddr(b.Projection.SourceIP)
		return a.Projection.PrincipalRef == b.Projection.PrincipalRef && a.Projection.AssetRef == b.Projection.AssetRef && x.Unmap() == y.Unmap()
	}
	findings := []Finding{}
	for _, success := range ordered {
		end, _ := time.Parse(time.RFC3339Nano, success.EventTime)
		if success.EventType != "authentication.succeeded" || end.After(watermark) {
			continue
		}
		failures := []Event{}
		for _, e := range ordered {
			t, _ := time.Parse(time.RFC3339Nano, e.EventTime)
			if e.EventType == "authentication.failed" && same(e, success) && t.Before(end) && !t.Before(end.Add(-5*time.Minute)) {
				failures = append(failures, e)
			}
		}
		if len(failures) < 3 {
			continue
		}
		evidence := append(append([]Event(nil), failures[len(failures)-3:]...), success)
		f := Finding{SchemaVersion: "1.0", TenantID: binding.TenantID, ConnectorID: binding.ConnectorID, Source: binding.Source, RuleID: "failed-then-success", RuleVersion: "1", Kind: "suspicious_login", Disposition: "requires_review", ObservedFrom: evidence[0].EventTime, ObservedUntil: success.EventTime}
		refs := map[string]bool{}
		for _, e := range evidence {
			f.EventKeys = append(f.EventKeys, e.Identity())
			refs[e.EvidenceRef] = true
		}
		for ref := range refs {
			f.EvidenceRefs = append(f.EvidenceRefs, ref)
		}
		sort.Strings(f.EvidenceRefs)
		f.FindingID = f.Identity()
		if err := f.ValidateEvidence(binding, evidence); err != nil {
			return nil, err
		}
		findings = append(findings, f)
	}
	return findings, nil
}
