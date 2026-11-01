// Package logincontext adapts bounded local IAM/MFA and EDR JSON observations.
// No URLs, filesystem access, provider credentials or executable instructions.
package logincontext

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/telemetry"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"google.golang.org/protobuf/proto"
	"regexp"
	"time"
)

var ErrInvalid = errors.New("invalid local login context")
var token = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
var digest = regexp.MustCompile(`^[0-9a-f]{64}$`)

type Process struct {
	PID       uint32 `json:"pid"`
	ParentPID uint32 `json:"parent_pid"`
	Image     string `json:"image"`
	SHA256    string `json:"sha256"`
}
type Observation struct {
	ConnectorID string    `json:"connector_id"`
	Reference   string    `json:"reference"`
	ObservedAt  string    `json:"observed_at"`
	RetrievedAt string    `json:"retrieved_at"`
	Outcome     string    `json:"outcome"`
	Processes   []Process `json:"processes,omitempty"`
}
type Bundle struct {
	SchemaVersion string        `json:"schema_version"`
	TenantID      string        `json:"tenant_id"`
	PrincipalRef  string        `json:"principal_ref"`
	AssetRef      string        `json:"asset_ref"`
	MaxAgeSeconds int           `json:"max_age_seconds"`
	IAM           []Observation `json:"iam"`
	EDR           []Observation `json:"edr"`
}

// Resolve evaluates freshness against the historical login, not present-day demo
// wall time. Retrieved timestamps may be later; they never make old evidence fresh.
func (b *Bundle) Resolve(binding telemetry.Binding, principal, asset string, login, now time.Time) ([]*pb.EvidenceItem, error) {
	if b == nil {
		return nil, nil
	}
	if b.SchemaVersion != "1" || !token.MatchString(b.PrincipalRef) || !token.MatchString(b.AssetRef) || b.TenantID != binding.TenantID || b.PrincipalRef != principal || b.AssetRef != asset || b.MaxAgeSeconds < 1 || b.MaxAgeSeconds > 3600 || len(b.IAM) > 2 || len(b.EDR) > 2 {
		return nil, ErrInvalid
	}
	refs := map[string]bool{}
	items := []*pb.EvidenceItem{}
	for index, group := range [][]Observation{b.IAM, b.EDR} {
		source := "mock-iam"
		kind := "iam.mfa"
		if index == 1 {
			source = "mock-edr"
			kind = "edr.endpoint"
		}
		for _, o := range group {
			state := "available"
			at, err := time.Parse(time.RFC3339Nano, o.ObservedAt)
			if err != nil {
				return nil, ErrInvalid
			}
			if at.After(login) || login.Sub(at) > time.Duration(b.MaxAgeSeconds)*time.Second {
				state = "stale"
			}
			c := &pb.EvidenceContext{Source: source, ConnectorId: o.ConnectorID, PrincipalRef: principal, AssetRef: asset, RetrievedAt: o.RetrievedAt, Outcome: o.Outcome, State: state}
			for _, p := range o.Processes {
				c.Processes = append(c.Processes, &pb.ProcessObservation{Pid: p.PID, ParentPid: p.ParentPID, Image: p.Image, Sha256: p.SHA256})
			}
			raw, _ := json.Marshal(struct {
				Tenant      string
				Kind        string
				Observation Observation
				Principal   string
				Asset       string
			}{b.TenantID, kind, o, principal, asset})
			sum := sha256.Sum256(raw)
			item := &pb.EvidenceItem{Reference: o.Reference, EventTime: o.ObservedAt, EventType: kind, ContentHash: hex.EncodeToString(sum[:]), Context: c}
			if refs[o.Reference] || Validate(item, now) != nil {
				return nil, ErrInvalid
			}
			refs[o.Reference] = true
			items = append(items, item)
		}
	}
	return items, nil
}

func Validate(e *pb.EvidenceItem, now time.Time) error {
	c := e.GetContext()
	if c == nil || len(c.ProtoReflect().GetUnknown()) != 0 || proto.Size(c) > 4096 || !token.MatchString(e.Reference) || !digest.MatchString(e.ContentHash) {
		return ErrInvalid
	}
	for _, s := range []string{c.ConnectorId, c.PrincipalRef, c.AssetRef} {
		if !token.MatchString(s) {
			return ErrInvalid
		}
	}
	at, err := time.Parse(time.RFC3339Nano, e.EventTime)
	if err != nil || at.Year() < 1970 || at.After(now) {
		return ErrInvalid
	}
	retrieved, err := time.Parse(time.RFC3339Nano, c.RetrievedAt)
	if err != nil || retrieved.Before(at) || retrieved.After(now) {
		return ErrInvalid
	}
	if c.State != "available" && c.State != "stale" {
		return ErrInvalid
	}
	if e.EventType == "iam.mfa" {
		if c.Source != "mock-iam" || (c.Outcome != "passed" && c.Outcome != "denied" && c.Outcome != "unknown") || len(c.Processes) != 0 {
			return ErrInvalid
		}
	} else if e.EventType == "edr.endpoint" {
		if c.Source != "mock-edr" || (c.Outcome != "clean" && c.Outcome != "suspicious" && c.Outcome != "unknown") || len(c.Processes) > 4 {
			return ErrInvalid
		}
	} else {
		return ErrInvalid
	}
	pids := map[uint32]bool{}
	for _, p := range c.Processes {
		if p == nil || len(p.ProtoReflect().GetUnknown()) != 0 || p.Pid == 0 || p.Pid == p.ParentPid || pids[p.Pid] || !token.MatchString(p.Image) || !digest.MatchString(p.Sha256) {
			return ErrInvalid
		}
		pids[p.Pid] = true
	}
	return nil
}

// Missing preserves uncertainty even when both local adapters supply context.
func Missing(items []*pb.EvidenceItem) []string {
	outcomes := map[string]map[string]bool{"iam.mfa": {}, "edr.endpoint": {}}
	hasContext := false
	for _, e := range items {
		if e.Context == nil {
			continue
		}
		hasContext = true
		c := e.Context
		if c.State == "available" && c.Outcome != "unknown" && (e.EventType != "edr.endpoint" || len(c.Processes) > 0) {
			outcomes[e.EventType][c.Outcome] = true
		}
	}
	result := []string{}
	if len(outcomes["iam.mfa"]) == 0 {
		result = append(result, "iam_mfa_context")
	}
	if len(outcomes["edr.endpoint"]) == 0 {
		result = append(result, "endpoint_process_tree")
	}
	if len(outcomes["iam.mfa"]) > 1 || len(outcomes["edr.endpoint"]) > 1 {
		result = append(result, "conflicting_context")
	}
	if hasContext {
		result = append(result, "independent_verification")
	}
	return result
}
