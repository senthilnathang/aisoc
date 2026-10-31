package response

import "testing"

func TestWorkflowPolicyValidation(t *testing.T) {
	good := Policy{Connector: "local-sandbox", Calling: "confirmation", Severity: "high"}
	if good.Validate() != nil {
		t.Fatal("valid policy rejected")
	}
	for _, change := range []func(*Policy){func(p *Policy) { p.Connector = "production" }, func(p *Policy) { p.Calling = "automatic" }, func(p *Policy) { p.Severity = "invalid" }} {
		bad := good
		change(&bad)
		if bad.Validate() == nil {
			t.Fatal("invalid policy accepted")
		}
	}
}
func TestWorkflowPreviewNeverExecutes(t *testing.T) {
	plan := Plan{Input: Input{Kind: "workflow", Steps: []Step{{Title: "Disable user", ApprovalRequired: true}, {Title: "Notify"}}}, Version: 2, State: "active"}
	p := Policy{Enabled: true, PlanVersion: 2, Severity: "high", Calling: "automatic_dry_run"}
	result := evaluatePreview(plan, p, "high", "IAM")
	if !result.Eligible || len(result.Steps) != 2 || result.Steps[0].Outcome != "approval_required" || result.Steps[1].Outcome != "would_run" {
		t.Fatal(result)
	}
	for _, policy := range []Policy{{Enabled: false, PlanVersion: 2}, {Enabled: true, PlanVersion: 1}, {Enabled: true, PlanVersion: 2, Severity: "critical"}, {Enabled: true, PlanVersion: 2, Source: "EDR"}} {
		if evaluatePreview(plan, policy, "high", "IAM").Eligible {
			t.Fatal("ineligible policy accepted")
		}
	}
	plan.State = "archived"
	if evaluatePreview(plan, p, "high", "IAM").Eligible {
		t.Fatal("archived plan eligible")
	}
}
