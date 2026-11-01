package approvals

import (
	"aisoc/backend/internal/platform/auth"
	"testing"
	"time"
)

func TestResponseAssignmentPreservesThreeIdentitiesAndScope(t *testing.T) {
	now := time.Now()
	item := map[string]any{"kind": "respond", "stage": "execution", "expires_at": now.Add(time.Minute).Format(time.RFC3339Nano), "document": map[string]any{"created_by": "proposer", "approved_by": "reviewer", "connector_id": "local", "source": "mock"}}
	binding := []auth.ApprovalBinding{{Connector: "local", Source: "mock"}}
	for _, id := range []string{"proposer", "reviewer"} {
		if eligible(auth.ApprovalOperator{ID: id, Roles: []string{"executor"}, Bindings: binding}, item, now) {
			t.Fatal("self execution", id)
		}
	}
	executor := auth.ApprovalOperator{ID: "executor", Roles: []string{"executor"}, Bindings: binding}
	if !eligible(executor, item, now) {
		t.Fatal("independent executor denied")
	}
	executor.Bindings = nil
	if eligible(executor, item, now) {
		t.Fatal("ungranted executor")
	}
	reviewer := auth.ApprovalOperator{ID: "reviewer", Roles: []string{"approver"}, Bindings: binding}
	if !ownerMayManage(reviewer, item, "reviewer") {
		t.Fatal("approver cannot hand off owned work to executor")
	}
	item["expires_at"] = now.Add(-time.Second).Format(time.RFC3339Nano)
	if required(item, now) != "approver" {
		t.Fatal("expired execution assigned")
	}
}
