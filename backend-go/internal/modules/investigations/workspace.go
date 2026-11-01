package investigations

import (
	"context"

	"unicode/utf8"
)

type EvidenceNode struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Value      string `json:"value"`
	Provenance string `json:"provenance"`
	RecordID   string `json:"record_id"`
}
type EvidenceEdge struct {
	From         string `json:"from"`
	To           string `json:"to"`
	Relationship string `json:"relationship"`
}
type Workspace struct {
	Case  *DetailRecord  `json:"case"`
	Nodes []EvidenceNode `json:"nodes"`
	Edges []EvidenceEdge `json:"edges"`
	Scope string         `json:"scope"`
}

func field(m map[string]any, key string) string { s, _ := m[key].(string); return s }
func bounded(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}
func projectCase(r *DetailRecord) *Workspace {
	root := "case:" + r.ID
	w := &Workspace{Case: r, Nodes: []EvidenceNode{{root, "case", r.Title, r.Summary, "Stored case record", r.ID}}, Edges: []EvidenceEdge{}, Scope: "Edges show recorded case membership, not causal or attack-path assertions. Latest 100 alerts, artifacts and steps are included; the projection is not exhaustive for larger cases."}
	for _, a := range r.Alerts {
		if len(w.Nodes) >= 201 {
			break
		}
		id := field(a, "id")
		if id == "" {
			continue
		}
		w.Nodes = append(w.Nodes, EvidenceNode{"alert:" + id, "alert", bounded(field(a, "title"), 200), field(a, "external_id"), field(a, "source"), id})
		w.Edges = append(w.Edges, EvidenceEdge{root, "alert:" + id, "received_alert"})
	}
	for _, a := range r.Artifacts {
		id := field(a, "id")
		if id == "" {
			continue
		}
		provenance := "Stored case artifact; provenance not recorded"
		if m, ok := a["metadata"].(map[string]any); ok && field(m, "provenance") != "" {
			provenance = field(m, "provenance")
		}
		if p, ok := a["provenance"].(map[string]any); ok && field(a, "type") == "hunt_finding" && field(p, "run_id") != "" {
			provenance = "Stored hunt run: " + field(p, "run_id") + "; analyst-promoted snapshot"
		}
		label := field(a, "label")
		if label == "" {
			label = field(a, "type")
		}
		w.Nodes = append(w.Nodes, EvidenceNode{"artifact:" + id, field(a, "type"), bounded(label, 200), bounded(field(a, "value"), 2000), bounded(provenance, 500), id})
		w.Edges = append(w.Edges, EvidenceEdge{root, "artifact:" + id, "attached_evidence"})
	}
	if r.PrimaryEntity != "" {
		w.Nodes = append(w.Nodes, EvidenceNode{"entity:" + r.ID, "entity", "Primary entity", r.PrimaryEntity, "Case primary_entity field", r.ID})
		w.Edges = append(w.Edges, EvidenceEdge{root, "entity:" + r.ID, "primary_entity"})
	}
	return w
}
func (s Store) Workspace(ctx context.Context, tenant, id string) (*Workspace, error) {
	r, e := s.detail(ctx, tenant, id, true)
	if e != nil {
		return nil, e
	}
	return projectCase(r), nil
}
