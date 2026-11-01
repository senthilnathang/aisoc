// Package localintegrations manages bounded local fixtures; never live connectors.
package localintegrations

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/modules/logincontext"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/fault"
	"encoding/json"
	"net/netip"
	"time"
)

type Document struct {
	SchemaVersion string               `json:"schema_version"`
	Events        []telemetry.Event    `json:"events"`
	Context       *logincontext.Bundle `json:"context,omitempty"`
}
type PreviewResult struct {
	Events   []telemetry.Event   `json:"events"`
	Findings []telemetry.Finding `json:"findings"`
	Context  []*pb.EvidenceItem  `json:"context"`
	Missing  []string            `json:"missing_evidence"`
	Mode     string              `json:"mode"`
}

func Invalid() error {
	return fault.New(400, "INVALID_LOCAL_INTEGRATION", "Provide 4–12 related login observations or four linked phishing observations; use valid tenant-bound evidence.")
}
func Conflict() error {
	return fault.New(409, "LOCAL_INTEGRATION_CONFLICT", "The draft changed or is sealed. Refresh; create a new profile to change imported evidence.")
}
func Preview(d Document, b telemetry.Binding, now time.Time) (PreviewResult, error) {
	p := PreviewResult{Mode: "local-json-mock-v1", Events: []telemetry.Event{}, Context: []*pb.EvidenceItem{}}
	raw, err := json.Marshal(d)
	if err != nil || len(raw) > 65536 || d.SchemaVersion != "1" || (len(d.Events) < 4 || len(d.Events) > 12) {
		return p, Invalid()
	}
	phishing := telemetry.IsPhishingEvent(d.Events[0].EventType)
	if phishing && (len(d.Events) != 4 || d.Context != nil) {
		return p, Invalid()
	}
	watermark := time.Time{}
	keys := map[string]bool{}
	for _, event := range d.Events {
		if event.TenantID != b.TenantID || event.Source != b.Source {
			return p, Invalid()
		}
		first := d.Events[0].Projection
		if telemetry.IsPhishingEvent(event.EventType) != phishing || event.Projection.MessageRef != first.MessageRef {
			return p, Invalid()
		}
		ip, ipErr := netip.ParseAddr(event.Projection.SourceIP)
		firstIP, firstErr := netip.ParseAddr(first.SourceIP)
		if ipErr != nil || firstErr != nil || ip.Unmap() != firstIP.Unmap() || event.Projection.PrincipalRef != first.PrincipalRef || event.Projection.AssetRef != first.AssetRef {
			return p, Invalid()
		}
		event.ConnectorID = b.ConnectorID
		if event.Validate(b) != nil || keys[event.Identity()] {
			return p, Invalid()
		}
		keys[event.Identity()] = true
		at, _ := time.Parse(time.RFC3339Nano, event.EventTime)
		if at.After(now) {
			return p, Invalid()
		}
		if at.After(watermark) {
			watermark = at
		}
		p.Events = append(p.Events, event)
	}
	p.Findings, err = telemetry.Correlate(b, p.Events, watermark.Add(time.Minute))
	if err != nil || len(p.Findings) != 1 {
		return p, Invalid()
	}
	// Keep the whole imported window related to the one selected finding.
	end, _ := time.Parse(time.RFC3339Nano, p.Findings[0].ObservedUntil)
	for _, event := range p.Events {
		at, _ := time.Parse(time.RFC3339Nano, event.EventTime)
		if at.After(end) || at.Before(end.Add(-5*time.Minute)) {
			return p, Invalid()
		}
	}
	if d.Context != nil {
		p.Context, err = d.Context.Resolve(b, p.Events[0].Projection.PrincipalRef, p.Events[0].Projection.AssetRef, watermark, now)
		if err != nil {
			return p, Invalid()
		}
	}
	task := &pb.InvestigationTask{TenantId: b.TenantID, IncidentId: "preview", TaskId: "preview", AttemptId: "preview", SchemaVersion: "1", Mode: l1.Mode, DeadlineUnixMs: now.Add(10 * time.Second).UnixMilli(), MaxOutputBytes: 8192}
	for _, e := range p.Events {
		task.Evidence = append(task.Evidence, &pb.EvidenceItem{Reference: e.EvidenceRef, ContentHash: e.ContentHash(), EventTime: e.EventTime, EventType: e.EventType})
	}
	task.Evidence = append(task.Evidence, p.Context...)
	if l1.ValidateTask(task, now) != nil {
		return p, fault.New(400, "INVALID_LOCAL_EVIDENCE", "Evidence references must be unique across source and context observations and fit the investigation budget.")
	}
	p.Missing = l1.MissingEvidence(task.Evidence)
	return p, nil
}
