package response

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/l1"
	"testing"
)

func TestCaseSandboxRequiresReviewedMockEvidence(t *testing.T) {
	in := CaseSandboxRequest{Operation: "propose", ID: "response-test", ScopeID: "sandbox", SessionID: "local-session", PrincipalRef: "user-a", Ticket: "REVIEW-1", Reason: "Reviewed suspicious login evidence", EvidenceRefs: []string{"evidence-1"}}
	review := l1.Review{Mode: "mock-v1", State: "completed", ResultStatus: "verified", SyncState: "synced", Evidence: []*pb.EvidenceItem{{Reference: "evidence-1", ContentHash: "abc"}}}
	if err := validateCaseProposal(in, review); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*CaseSandboxRequest, *l1.Review){
		func(i *CaseSandboxRequest, r *l1.Review) { i.EvidenceRefs = []string{"invented"} },
		func(i *CaseSandboxRequest, r *l1.Review) { i.EvidenceRefs = []string{"evidence-1", "evidence-1"} },
		func(i *CaseSandboxRequest, r *l1.Review) { i.Reason = "" },
		func(i *CaseSandboxRequest, r *l1.Review) { r.SyncState = "awaiting_review" },
		func(i *CaseSandboxRequest, r *l1.Review) { r.ResultStatus = "invalid" },
		func(i *CaseSandboxRequest, r *l1.Review) { r.Mode = "model" },
	} {
		copyIn, copyReview := in, review
		change(&copyIn, &copyReview)
		if validateCaseProposal(copyIn, copyReview) == nil {
			t.Fatal("unsafe proposal accepted")
		}
	}
}
