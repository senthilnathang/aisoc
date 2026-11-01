package telemetry

import (
	"net/netip"
	"sort"
	"time"
)

func IsPhishingEvent(kind string) bool {
	switch kind {
	case "email.delivered", "email.authentication_failed", "email.link_clicked", "email.credential_submitted":
		return true
	}
	return false
}

// Correlate retains the established login rule and adds one bounded mail rule.
// Neither rule evaluates a verdict or authorizes a response.
func Correlate(b Binding, events []Event, watermark time.Time) ([]Finding, error) {
	login, err := SuspiciousLogins(b, events, watermark)
	if err != nil {
		return nil, err
	}
	mail, err := Phishing(b, events, watermark)
	if err != nil {
		return nil, err
	}
	return append(login, mail...), nil
}

// Phishing requires one unambiguous, ordered observation of each stage for the
// same message/user/device/IP. Duplicate delivery is harmless; conflicting content
// or source revisions fail closed. Late/partial/out-of-order *arrival* is handled
// by recomputing the caller's authoritative snapshot in event time.
func Phishing(b Binding, events []Event, watermark time.Time) ([]Finding, error) {
	if len(events) > 100 || watermark.IsZero() {
		return nil, ErrInvalid
	}
	type key struct{ message, principal, asset, ip string }
	groups := map[key]map[string][]Event{}
	unique := map[string]Event{}
	revisions := map[string]string{}
	for _, e := range events {
		if err := e.Validate(b); err != nil {
			return nil, err
		}
		id := e.Identity()
		if old, ok := unique[id]; ok {
			if old.ContentHash() != e.ContentHash() {
				return nil, ErrInvalid
			}
			continue
		}
		if prior, ok := revisions[e.SourceEventID]; ok && prior != id {
			return nil, ErrRevisionAmbiguous
		}
		unique[id] = e
		revisions[e.SourceEventID] = id
		if !IsPhishingEvent(e.EventType) {
			continue
		}
		ip, _ := netip.ParseAddr(e.Projection.SourceIP)
		k := key{e.Projection.MessageRef, e.Projection.PrincipalRef, e.Projection.AssetRef, ip.Unmap().String()}
		if groups[k] == nil {
			groups[k] = map[string][]Event{}
		}
		groups[k][e.EventType] = append(groups[k][e.EventType], e)
	}
	findings := []Finding{}
	for _, group := range groups {
		ordered := []Event{}
		for _, kind := range []string{"email.delivered", "email.authentication_failed", "email.link_clicked", "email.credential_submitted"} {
			if len(group[kind]) != 1 {
				break
			}
			ordered = append(ordered, group[kind][0])
		}
		if len(ordered) != 4 {
			continue
		}
		start, _ := time.Parse(time.RFC3339Nano, ordered[0].EventTime)
		end, _ := time.Parse(time.RFC3339Nano, ordered[3].EventTime)
		if end.After(watermark) || end.Sub(start) > 5*time.Minute {
			continue
		}
		valid := true
		last := start
		for _, e := range ordered[1:] {
			at, _ := time.Parse(time.RFC3339Nano, e.EventTime)
			if !at.After(last) {
				valid = false
			}
			last = at
		}
		if !valid {
			continue
		}
		f := Finding{SchemaVersion: "1.0", TenantID: b.TenantID, ConnectorID: b.ConnectorID, Source: b.Source, RuleID: "mail-credential-submission", RuleVersion: "1", Kind: "credential_phishing", Disposition: "requires_review", ObservedFrom: ordered[0].EventTime, ObservedUntil: ordered[3].EventTime}
		refs := map[string]bool{}
		for _, e := range ordered {
			f.EventKeys = append(f.EventKeys, e.Identity())
			refs[e.EvidenceRef] = true
		}
		for ref := range refs {
			f.EvidenceRefs = append(f.EvidenceRefs, ref)
		}
		sort.Strings(f.EvidenceRefs)
		f.FindingID = f.Identity()
		if err := f.ValidateEvidence(b, ordered); err != nil {
			return nil, err
		}
		findings = append(findings, f)
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].FindingID < findings[j].FindingID })
	return findings, nil
}
