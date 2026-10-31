package routing

import "testing"

func TestPrecedenceExceptionsAndProtectedEscalation(t *testing.T) {
	c := Config{Policies: []Policy{{ID: "first", Name: "Suppress scanner", Status: "enabled", Outcome: "Suppress", Source: "scanner", ExceptList: "trusted"}, {ID: "second", Name: "Review", Status: "enabled", Outcome: "Investigate"}}, Lists: []EntityList{{ID: "trusted", Name: "Trusted", Values: []string{"vip"}}}}
	if err := Validate(c); err != nil {
		t.Fatal(err)
	}
	e := Event{Source: "scanner", Entity: "ordinary", Fallback: "Investigate", Enabled: true}
	d := Evaluate(c, 3, e)
	if d.PolicyID != "first" || d.Outcome != "Suppress" {
		t.Fatal(d)
	}
	e.Entity = "vip"
	d = Evaluate(c, 3, e)
	if d.PolicyID != "second" {
		t.Fatal(d)
	}
	e.Fallback = "Escalate"
	d = Evaluate(c, 3, e)
	if d.Outcome != "Escalate" || d.PolicyID != "" {
		t.Fatal(d)
	}
	e.Enabled = false
	if Evaluate(c, 3, e).Outcome != "Disabled" {
		t.Fatal("disabled overridden")
	}
	c.Policies[0].Outcome = "Quarantine"
	if Validate(c) == nil {
		t.Fatal("privileged action accepted")
	}
	c.Policies[0].Outcome = "Suppress"
	c.Lists = nil
	if Validate(c) == nil {
		t.Fatal("dangling list accepted")
	}
}
