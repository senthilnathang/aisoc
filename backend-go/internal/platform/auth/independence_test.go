package auth

import "testing"

func TestIndependentApproval(t *testing.T) {
	d := map[string]any{"created_by": "alice"}
	RecordProposer(d, "bob")
	RecordProposer(d, "carol")
	for _, actor := range []string{"alice", "bob", "carol", ""} {
		if Independent(d, actor) == nil {
			t.Errorf("allowed author %q", actor)
		}
	}
	if err := Independent(d, "reviewer"); err != nil {
		t.Fatal(err)
	}
	if Independent(map[string]any{}, "reviewer") == nil {
		t.Fatal("unknown provenance approved")
	}
}
