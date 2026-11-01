package detection

import (
	"context"
	"testing"
)

func TestCaseFeedbackRequiresExplicitApproval(t *testing.T) {
	s := Store{}
	zero := 0
	for _, in := range []CaseAlertLabelInput{{}, {Confirm: true, Label: "false_positive", Rationale: "Reviewed evidence"}, {Confirm: true, ExpectedVersion: &zero, Label: "benign", Rationale: "Reviewed evidence"}, {Confirm: false, ExpectedVersion: &zero, Label: "false_positive", Rationale: "Reviewed evidence"}} {
		if _, e := s.LabelCaseAlert(context.Background(), "tenant", "actor", "case", "alert", in); e == nil {
			t.Fatal("accepted invalid approval")
		}
	}
}
