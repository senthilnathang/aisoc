package detection

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCoverageReferenceAndProjection(t *testing.T) {
	ref, err := attackReference()
	if err != nil {
		t.Fatal(err)
	}
	if len(ref.Tactics) != 14 || len(ref.Techniques) != 679 || ref.Version != "17.1" {
		t.Fatal("unexpected reference")
	}
	now := time.Now()
	r := CoverageRule{ID: "r", Name: "Rule", Enabled: true, Version: 1, Techniques: []string{"T1059.001", "T1059.001", "invalid"}}
	in := coverageInputs{AsOf: now, Rules: []CoverageRule{r}}
	projected := projectCoverage(ref, in)
	get := func(out CoverageResult, id string) CoverageTechnique {
		for _, tech := range out.Techniques {
			if tech.ID == id {
				return tech
			}
		}
		t.Fatal("missing", id)
		return CoverageTechnique{}
	}
	if len(get(projected, "T1059.001").Rules) != 1 || len(get(projected, "T1059").Rules) != 0 {
		t.Fatal("duplicate/inherited mapping")
	}
	for _, tactic := range projected.Tactics {
		if tactic.CoveragePercent != nil {
			t.Fatal("unassessed score fabricated")
		}
	}
	if len(projected.UnrecognizedMappings) != 1 {
		t.Fatal("unknown tag hidden")
	}
	in.Assessments = []CoverageAssessment{{TechniqueID: "T1059.001", State: "covered", EvidenceRef: "test:1", RuleID: "r", RuleVersion: 1, ExpiresAt: now.Add(time.Hour)}}
	if get(projectCoverage(ref, in), "T1059.001").Status != "covered" {
		t.Fatal("valid attestation ignored")
	}
	in.Rules[0].Version = 2
	if get(projectCoverage(ref, in), "T1059.001").Status != "stale" {
		t.Fatal("version change not invalidated")
	}
	in.Rules[0].Version = 1
	in.Rules[0].Enabled = false
	if get(projectCoverage(ref, in), "T1059.001").Status != "stale" {
		t.Fatal("disabled rule counted")
	}
	in.Rules[0].Enabled = true
	in.Assessments[0].ExpiresAt = now.Add(-time.Second)
	if get(projectCoverage(ref, in), "T1059.001").Status != "expired" {
		t.Fatal("expired review counted")
	}
	for _, state := range []string{"accepted_risk", "alternative_control", "not_applicable"} {
		in.Assessments[0].State = state
		in.Assessments[0].ExpiresAt = now.Add(time.Hour)
		out := projectCoverage(ref, in)
		for _, tactic := range out.Tactics {
			if tactic.Covered != 0 {
				t.Fatal("non-detection inflated coverage")
			}
			if tactic.ID == "TA0002" && state == "not_applicable" && tactic.Eligible != tactic.Total-1 {
				t.Fatal("applicability denominator incorrect")
			}
		}
	}
}
func TestCoverageAssessmentPersistenceIsolationAndAudit(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "coverage-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"detection_coverage_assessments", "detection_rules", "audit_events", "tenants"} {
			column := "tenant_id"
			if table == "tenants" {
				column = "id"
			}
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE `+column+`=ANY($1)`, []string{tenant, tenant + "-other"})
		}
	}()
	rule, err := s.Create(ctx, tenant, map[string]any{"name": "PowerShell", "severity": "high", "mitre_techniques": []any{"T1059.001"}})
	if err != nil {
		t.Fatal(err)
	}
	input := CoverageInput{ReferenceVersion: "17.1", State: "covered", RuleID: rule["id"].(string), RuleVersion: 1, Notes: "Sandbox test observed expected alert", EvidenceRef: "test://local/1", ExpiresAt: time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)}
	if _, err = s.SaveCoverage(ctx, tenant+"-other", "reviewer", "T1059.001", input); err == nil {
		t.Fatal("foreign rule accepted")
	}
	v, err := s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", input)
	if err != nil || v != 1 {
		t.Fatal("save", v, err)
	}
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", input); err == nil {
		t.Fatal("stale write accepted")
	}
	out, err := s.Coverage(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tech := range out.Techniques {
		if tech.ID == "T1059.001" {
			found = tech.Status == "covered" && tech.Assessment.Reviewer == "reviewer"
		}
	}
	if !found {
		t.Fatal("persistence missing")
	}
	foreign, err := s.Coverage(ctx, tenant+"-other")
	if err != nil {
		t.Fatal(err)
	}
	for _, tech := range foreign.Techniques {
		if tech.Assessment != nil || len(tech.Rules) > 0 {
			t.Fatal("cross tenant leak")
		}
	}
	bad := input
	bad.ExpectedVersion = 1
	bad.EvidenceRef = ""
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", bad); err == nil {
		t.Fatal("evidence required")
	}
	bad = input
	bad.ExpiresAt = time.Now().Add(-time.Hour).Format(time.RFC3339)
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", bad); err == nil {
		t.Fatal("expiry validation")
	}
	bad = input
	bad.ExpectedVersion = 2147483648
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", bad); err == nil {
		t.Fatal("int32 overflow accepted")
	}
	// Force audit failure after the upsert; both changes must roll back.
	name := pgx.Identifier{"fail_coverage_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.resource='detection_coverage' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	input.ExpectedVersion = 1
	input.State = "accepted_risk"
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", input); err == nil {
		t.Fatal("write survived audit failure")
	}
	out, err = s.Coverage(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	for _, tech := range out.Techniques {
		if tech.ID == "T1059.001" && tech.Assessment.Version != 1 {
			t.Fatal("partial assessment persisted")
		}
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", input); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Update(ctx, tenant, rule["id"].(string), map[string]any{"enabled": false}, []string{"enabled"}, 1, false); err != nil {
		t.Fatal(err)
	}
	input.ExpectedVersion = 2
	input.State = "covered"
	if _, err = s.SaveCoverage(ctx, tenant, "reviewer", "T1059.001", input); err == nil {
		t.Fatal("disabled rule accepted")
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='detection_coverage'`, tenant).Scan(&count); err != nil || count != 2 {
		t.Fatal("audit count", count, err)
	}
}
