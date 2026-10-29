// Package l1 implements the sandbox investigation boundary. No action authorization.
package l1

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"errors"
	"google.golang.org/protobuf/proto"
	"regexp"
	"time"
)

var ErrInvalid = errors.New("invalid or unsupported investigation contract")
var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
var hash = regexp.MustCompile(`^[0-9a-f]{64}$`)
var modelLabel = regexp.MustCompile(`^json-model:[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`)
var missingLabel = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

const Mode = "mock-v1"
const ModelMode = "model-v1"

// ValidateTask bounds both mock and explicitly requested model tasks. Neither
// contract carries tools, action credentials or authority to execute a response.
func ValidateTask(t *pb.InvestigationTask, now time.Time) error {
	if t == nil || proto.Size(t) > 16384 || len(t.ProtoReflect().GetUnknown()) != 0 || t.SchemaVersion != "1" || (t.Mode != Mode && t.Mode != ModelMode) || t.MaxOutputBytes < 512 || t.MaxOutputBytes > 16384 || len(t.Evidence) < 1 || len(t.Evidence) > 16 {
		return ErrInvalid
	}
	for _, s := range []string{t.TenantId, t.IncidentId, t.TaskId, t.AttemptId} {
		if !identifier.MatchString(s) {
			return ErrInvalid
		}
	}
	deadline := time.UnixMilli(t.DeadlineUnixMs)
	if !deadline.After(now) || deadline.After(now.Add(30*time.Second)) {
		return ErrInvalid
	}
	refs := map[string]bool{}
	for _, e := range t.Evidence {
		if e == nil || len(e.ProtoReflect().GetUnknown()) != 0 || !identifier.MatchString(e.Reference) || refs[e.Reference] || !hash.MatchString(e.ContentHash) {
			return ErrInvalid
		}
		when, err := time.Parse(time.RFC3339Nano, e.EventTime)
		if err != nil || when.Year() < 1970 || when.After(now) {
			return ErrInvalid
		}
		if e.EventType != "authentication.failed" && e.EventType != "authentication.succeeded" {
			return ErrInvalid
		}
		refs[e.Reference] = true
	}
	return nil
}

// VerifyResult is a deterministic veto. Even valid mock output remains inconclusive.
// Citations prove membership, not truth or sufficient grounds for response.
func VerifyResult(t *pb.InvestigationTask, r *pb.InvestigationResult, now time.Time) error {
	if ValidateTask(t, now) != nil || r == nil || proto.Size(r) > int(t.MaxOutputBytes) || len(r.ProtoReflect().GetUnknown()) != 0 {
		return ErrInvalid
	}
	if r.TenantId != t.TenantId || r.IncidentId != t.IncidentId || r.TaskId != t.TaskId || r.AttemptId != t.AttemptId || r.SchemaVersion != "1" || !r.RequiresHumanReview || len(r.Hypotheses) != 2 {
		return ErrInvalid
	}
	if t.Mode == Mode {
		if r.Verdict != "INCONCLUSIVE" || r.ModelVersion != "deterministic-mock-v1" {
			return ErrInvalid
		}
	} else {
		if (r.Verdict != "INCONCLUSIVE" && r.Verdict != "SUSPICIOUS" && r.Verdict != "BENIGN" && r.Verdict != "MALICIOUS") || !modelLabel.MatchString(r.ModelVersion) {
			return ErrInvalid
		}
	}
	refs := map[string]bool{}
	for _, e := range t.Evidence {
		refs[e.Reference] = true
	}
	kinds := map[string]bool{}
	for _, h := range r.Hypotheses {
		if h == nil || len(h.ProtoReflect().GetUnknown()) != 0 || kinds[h.Kind] || (h.Kind != "credential_compromise" && h.Kind != "legitimate_user_or_automation") || len(h.SupportingRefs) == 0 || len(h.SupportingRefs) > 16 || len(h.CounterevidenceRefs) > 16 {
			return ErrInvalid
		}
		kinds[h.Kind] = true
		seen := map[string]bool{}
		for _, group := range [][]string{h.SupportingRefs, h.CounterevidenceRefs} {
			for _, ref := range group {
				if !refs[ref] || seen[ref] {
					return ErrInvalid
				}
				seen[ref] = true
			}
		}
		if len(seen) != len(refs) {
			return ErrInvalid
		}
	}
	missing := map[string]bool{}
	for _, s := range r.MissingEvidence {
		if missing[s] || (t.Mode == Mode && s != "iam_mfa_context" && s != "endpoint_process_tree") || !missingLabel.MatchString(s) {
			return ErrInvalid
		}
		missing[s] = true
	}
	if (t.Mode == Mode && len(missing) != 2) || len(missing) < 1 || len(missing) > 16 {
		return ErrInvalid
	}
	return nil
}
