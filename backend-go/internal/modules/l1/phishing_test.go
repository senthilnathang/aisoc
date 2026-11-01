package l1

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
	"time"
)

func TestPhishingTaskAndQABoundaries(t *testing.T) {
	now := time.Now()
	task := &pb.InvestigationTask{TenantId: "tenant", IncidentId: "case", TaskId: "task", AttemptId: "attempt", SchemaVersion: "1", Mode: Mode, DeadlineUnixMs: now.Add(10 * time.Second).UnixMilli(), MaxOutputBytes: 8192}
	refs := []string{"mail:1", "mail:2", "mail:3", "mail:4"}
	for i, kind := range []string{"email.delivered", "email.authentication_failed", "email.link_clicked", "email.credential_submitted"} {
		task.Evidence = append(task.Evidence, &pb.EvidenceItem{Reference: refs[i], ContentHash: strings.Repeat("a", 64), EventTime: now.Add(-time.Minute).UTC().Format(time.RFC3339), EventType: kind})
	}
	result := &pb.InvestigationResult{TenantId: "tenant", IncidentId: "case", TaskId: "task", AttemptId: "attempt", SchemaVersion: "1", Verdict: "INCONCLUSIVE", RequiresHumanReview: true, ModelVersion: "deterministic-mock-v1", MissingEvidence: []string{"email_headers", "url_reputation", "authorized_simulation_check", "iam_session_context", "independent_verification"}, Hypotheses: []*pb.Hypothesis{{Kind: "credential_phishing", SupportingRefs: refs}, {Kind: "authorized_simulation", SupportingRefs: refs[:1], NeutralRefs: refs[1:]}}}
	if err := VerifyResult(task, result, now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*pb.InvestigationResult){func(r *pb.InvestigationResult) { r.Verdict = "MALICIOUS" }, func(r *pb.InvestigationResult) { r.MissingEvidence = r.MissingEvidence[:1] }, func(r *pb.InvestigationResult) {
		r.Hypotheses[1].SupportingRefs = refs
		r.Hypotheses[1].NeutralRefs = nil
	}, func(r *pb.InvestigationResult) { r.Hypotheses[0].SupportingRefs[0] = "invented" }} {
		r := proto.Clone(result).(*pb.InvestigationResult)
		mutate(r)
		if VerifyResult(task, r, now) == nil {
			t.Fatal("unsafe phishing result")
		}
	}
	for _, mutate := range []func(*pb.InvestigationTask){func(v *pb.InvestigationTask) { v.Mode = ModelMode }, func(v *pb.InvestigationTask) { v.Evidence = v.Evidence[:3] }, func(v *pb.InvestigationTask) { v.Evidence[0].EventType = "authentication.failed" }} {
		v := proto.Clone(task).(*pb.InvestigationTask)
		mutate(v)
		if ValidateTask(v, now) == nil {
			t.Fatal("mixed/incomplete/model phishing task")
		}
	}
}
