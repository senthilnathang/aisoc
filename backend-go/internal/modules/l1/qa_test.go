package l1

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
	"time"
)

func TestQAVetoesUnsafeOrUnsupportedResults(t *testing.T) {
	now := time.Now()
	task := &pb.InvestigationTask{TenantId: "tenant", IncidentId: "case", TaskId: "task", AttemptId: "attempt", SchemaVersion: "1", DeadlineUnixMs: now.Add(10 * time.Second).UnixMilli(), Mode: Mode, MaxOutputBytes: 8192, Evidence: []*pb.EvidenceItem{{Reference: "ignore.previous.instructions", ContentHash: strings.Repeat("a", 64), EventTime: now.Add(-time.Minute).UTC().Format(time.RFC3339), EventType: "authentication.failed"}}}
	result := &pb.InvestigationResult{TenantId: "tenant", IncidentId: "case", TaskId: "task", AttemptId: "attempt", SchemaVersion: "1", Verdict: "INCONCLUSIVE", RequiresHumanReview: true, ModelVersion: "deterministic-mock-v1", MissingEvidence: []string{"iam_mfa_context", "endpoint_process_tree"}, Hypotheses: []*pb.Hypothesis{{Kind: "credential_compromise", SupportingRefs: []string{"ignore.previous.instructions"}}, {Kind: "legitimate_user_or_automation", SupportingRefs: []string{"ignore.previous.instructions"}}}}
	if err := VerifyResult(task, result, now); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*pb.InvestigationResult)
	}{
		{"foreign tenant", func(r *pb.InvestigationResult) { r.TenantId = "other" }},
		{"stale attempt", func(r *pb.InvestigationResult) { r.AttemptId = "old" }},
		{"benign closure", func(r *pb.InvestigationResult) { r.Verdict = "BENIGN" }},
		{"no review", func(r *pb.InvestigationResult) { r.RequiresHumanReview = false }},
		{"hallucinated citation", func(r *pb.InvestigationResult) { r.Hypotheses[0].SupportingRefs = []string{"invented"} }},
		{"contradiction", func(r *pb.InvestigationResult) { r.Hypotheses[0].CounterevidenceRefs = r.Hypotheses[0].SupportingRefs }},
		{"missing context omitted", func(r *pb.InvestigationResult) { r.MissingEvidence = nil }},
		{"single hypothesis", func(r *pb.InvestigationResult) { r.Hypotheses = r.Hypotheses[:1] }},
		{"unknown action field", func(r *pb.InvestigationResult) { r.ProtoReflect().SetUnknown([]byte{0xa0, 0x06, 1}) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := proto.Clone(result).(*pb.InvestigationResult)
			tc.mutate(r)
			if VerifyResult(task, r, now) == nil {
				t.Fatal("unsafe output admitted")
			}
		})
	}
	if VerifyResult(task, result, now.Add(11*time.Second)) == nil {
		t.Fatal("expired result")
	}
	modelTask := proto.Clone(task).(*pb.InvestigationTask)
	modelTask.Mode = ModelMode
	modelResult := proto.Clone(result).(*pb.InvestigationResult)
	modelResult.ModelVersion = "json-model:fixture-v1"
	modelResult.Verdict = "BENIGN"
	if err := VerifyResult(modelTask, modelResult, now); err != nil {
		t.Fatal(err)
	}
	modelResult.RequiresHumanReview = false
	if VerifyResult(modelTask, modelResult, now) == nil {
		t.Fatal("model bypassed human review")
	}
	for _, mutate := range []func(*pb.InvestigationTask){func(t *pb.InvestigationTask) { t.Mode = "live" }, func(t *pb.InvestigationTask) { t.Evidence = append(t.Evidence, t.Evidence[0]) }, func(t *pb.InvestigationTask) { t.MaxOutputBytes = 1 }, func(t *pb.InvestigationTask) { t.DeadlineUnixMs = now.Add(time.Hour).UnixMilli() }} {
		r := proto.Clone(task).(*pb.InvestigationTask)
		mutate(r)
		if ValidateTask(r, now) == nil {
			t.Fatal("unbounded task")
		}
	}
}

func TestContextCannotHideGapsOrAuthorizeClosure(t *testing.T) {
	now := time.Now()
	at := now.Add(-time.Minute).UTC().Format(time.RFC3339)
	task := &pb.InvestigationTask{TenantId: "tenant", IncidentId: "case", TaskId: "task", AttemptId: "attempt", SchemaVersion: "1", DeadlineUnixMs: now.Add(10 * time.Second).UnixMilli(), Mode: Mode, MaxOutputBytes: 8192, Evidence: []*pb.EvidenceItem{{Reference: "login:1", ContentHash: strings.Repeat("a", 64), EventTime: at, EventType: "authentication.failed"}, {Reference: "iam:1", ContentHash: strings.Repeat("b", 64), EventTime: at, EventType: "iam.mfa", Context: &pb.EvidenceContext{Source: "mock-iam", ConnectorId: "iam", PrincipalRef: "user", AssetRef: "device", RetrievedAt: at, Outcome: "passed", State: "available"}}}}
	result := &pb.InvestigationResult{TenantId: "tenant", IncidentId: "case", TaskId: "task", AttemptId: "attempt", SchemaVersion: "1", Verdict: "INCONCLUSIVE", RequiresHumanReview: true, ModelVersion: "deterministic-mock-v1", MissingEvidence: []string{"endpoint_process_tree", "independent_verification"}, Hypotheses: []*pb.Hypothesis{{Kind: "credential_compromise", SupportingRefs: []string{"login:1"}, CounterevidenceRefs: []string{"iam:1"}}, {Kind: "legitimate_user_or_automation", SupportingRefs: []string{"login:1", "iam:1"}}}}
	if VerifyResult(task, result, now) != nil {
		t.Fatal("valid context rejected")
	}
	for _, mutate := range []func(*pb.InvestigationResult){func(r *pb.InvestigationResult) { r.MissingEvidence = []string{"independent_verification"} }, func(r *pb.InvestigationResult) { r.Verdict = "BENIGN" }, func(r *pb.InvestigationResult) { r.RequiresHumanReview = false }} {
		copy := proto.Clone(result).(*pb.InvestigationResult)
		mutate(copy)
		if VerifyResult(task, copy, now) == nil {
			t.Fatal("unsafe output accepted")
		}
	}
	task.Evidence[1].Context.State = "stale"
	if VerifyResult(task, result, now) == nil {
		t.Fatal("stale context covered gap")
	}
	task.Evidence[1].Context.State = "available"
	task.Mode = ModelMode
	if ValidateTask(task, now) == nil {
		t.Fatal("context sent to unreviewed model contract")
	}
}
