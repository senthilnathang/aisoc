package learning

import "testing"

func TestApprovalContract(t *testing.T) {
	good := Input{ExpectedUpdatedAt: "2026-11-01T00:00:00Z", EvidenceIDs: []string{"a"}, Confirm: true, Rationale: "Reviewed case outcome and supporting evidence.", CreateSkill: true, Name: "Review identity context", Guidance: "Check the current evidence before deciding."}
	if e := validate(good); e != nil {
		t.Fatal(e)
	}
	for _, modify := range []func(*Input){func(x *Input) { x.Confirm = false }, func(x *Input) { x.EvidenceIDs = nil }, func(x *Input) { x.EvidenceIDs = []string{"a", "a"} }, func(x *Input) { x.Guidance = "" }, func(x *Input) { x.CreateSkill = false }, func(x *Input) { x.ExpectedUpdatedAt = "bad" }} {
		x := good
		modify(&x)
		if validate(x) == nil {
			t.Fatal("unsafe input accepted", x)
		}
	}
}
