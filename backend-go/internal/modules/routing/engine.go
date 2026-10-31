package routing

import (
	"fmt"
	"regexp"
	"strings"
)

type Policy struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Outcome     string `json:"outcome"`
	Source      string `json:"source"`
	Severity    string `json:"severity"`
	RuleID      string `json:"rule_id"`
	EntityList  string `json:"entity_list"`
	ExceptList  string `json:"except_list"`
}
type EntityList struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Values []string `json:"values"`
}
type Config struct {
	Policies []Policy     `json:"policies"`
	Lists    []EntityList `json:"lists"`
}
type Event struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	ExternalID string `json:"external_id"`
	RuleID     string `json:"rule_id"`
	Severity   string `json:"severity"`
	Entity     string `json:"entity"`
	Fallback   string `json:"fallback"`
	Enabled    bool   `json:"enabled"`
}
type Decision struct {
	Outcome  string `json:"outcome"`
	PolicyID string `json:"policy_id"`
	Version  int    `json:"version"`
	Reason   string `json:"reason"`
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func one(v string, choices ...string) bool {
	for _, x := range choices {
		if v == x {
			return true
		}
	}
	return false
}
func Validate(c Config) error {
	if c.Policies == nil || c.Lists == nil {
		return fmt.Errorf("Policies and lists must be explicit arrays")
	}
	if len(c.Policies) > 100 || len(c.Lists) > 50 {
		return fmt.Errorf("Limit: 100 policies and 50 entity lists")
	}
	ids := map[string]bool{}
	for _, l := range c.Lists {
		if !identifier.MatchString(l.ID) || ids[l.ID] || strings.TrimSpace(l.Name) == "" || len(l.Name) > 200 || len(l.Values) > 500 {
			return fmt.Errorf("Invalid entity list or duplicate ID")
		}
		ids[l.ID] = true
		seen := map[string]bool{}
		for _, v := range l.Values {
			if strings.TrimSpace(v) == "" || len(v) > 256 || seen[v] {
				return fmt.Errorf("Entity values must be unique nonempty literals up to 256 bytes")
			}
			seen[v] = true
		}
	}
	seen := map[string]bool{}
	for _, p := range c.Policies {
		if !identifier.MatchString(p.ID) || seen[p.ID] || strings.TrimSpace(p.Name) == "" || len(p.Name) > 200 || len(p.Description) > 2000 || len(p.Source) > 200 || len(p.RuleID) > 256 {
			return fmt.Errorf("Invalid policy fields or duplicate ID")
		}
		seen[p.ID] = true
		if !one(p.Status, "draft", "enabled", "archived") || !one(p.Outcome, "Investigate", "Sample (10%)", "Suppress", "Escalate") || !one(p.Severity, "", "low", "medium", "high", "critical") {
			return fmt.Errorf("Unsupported policy status, outcome or severity")
		}
		if p.EntityList != "" && !ids[p.EntityList] || p.ExceptList != "" && !ids[p.ExceptList] {
			return fmt.Errorf("Referenced entity list does not exist")
		}
	}
	return nil
}
func Evaluate(c Config, version int, e Event) Decision {
	d := Decision{Outcome: e.Fallback, Version: version, Reason: "Per-rule fallback; no enabled universal policy matched"}
	if !e.Enabled {
		d.Outcome = "Disabled"
		d.Reason = "Disabled detection rule cannot ingest"
		return d
	}
	if e.Fallback == "Escalate" {
		d.Reason = "Protected per-rule escalation; universal policies cannot downgrade it"
		return d
	}
	member := func(id, value string) bool {
		for _, l := range c.Lists {
			if l.ID == id {
				for _, v := range l.Values {
					if v == value {
						return true
					}
				}
			}
		}
		return false
	}
	for _, p := range c.Policies {
		if p.Status != "enabled" || p.Source != "" && p.Source != e.Source || p.Severity != "" && p.Severity != e.Severity || p.RuleID != "" && p.RuleID != e.RuleID || p.EntityList != "" && !member(p.EntityList, e.Entity) || p.ExceptList != "" && member(p.ExceptList, e.Entity) {
			continue
		}
		return Decision{p.Outcome, p.ID, version, "First matching enabled policy: " + p.Name}
	}
	if !one(d.Outcome, "Investigate", "Sample (10%)", "Suppress", "Escalate") {
		d.Outcome = "Investigate"
		d.Reason = "Unknown per-rule route; safe investigate fallback"
	}
	return d
}
