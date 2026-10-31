package response

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestResponseWorkspaceIsolationVersioningAndPreview(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
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
	tenant := "response-workspace-" + jobs.ID()
	s := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	defer func() {
		pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM response_plan_versions WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM response_plans WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	plan, err := s.Create(ctx, tenant, Input{Kind: "workflow", Title: "Session review", Domain: "Identity", Trigger: "Suspicious login", Steps: []Step{{Title: "Review evidence", ApprovalRequired: true}, {Title: "Propose session revocation"}}}, "analyst")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Policy(ctx, tenant, plan.ID)
	if err != nil || p.Enabled || p.Version != 0 {
		t.Fatal(p, err)
	}
	p.Enabled = true
	p.Calling = "automatic_dry_run"
	p.Severity = "high"
	p, err = s.SavePolicy(ctx, tenant, plan.ID, "analyst", 0, 1, p)
	if err != nil || p.Version != 1 {
		t.Fatal(p, err)
	}
	if _, err = s.SavePolicy(ctx, tenant, plan.ID, "analyst", 0, 1, p); err == nil {
		t.Fatal("stale policy accepted")
	}
	if _, err = s.Policy(ctx, "foreign", plan.ID); err == nil {
		t.Fatal("cross-tenant policy read")
	}
	if _, err = s.SavePolicy(ctx, "foreign", plan.ID, "analyst", 1, 1, p); err == nil {
		t.Fatal("cross-tenant policy write")
	}
	foreign, err := s.Policies(ctx, "foreign")
	if err != nil || len(foreign) != 0 {
		t.Fatal(foreign, err)
	}
	c, err := cases.Create(ctx, tenant, investigations.Input{Title: "Suspicious login", Source: "IAM", Severity: "high", Status: "open", Determination: "unknown", Category: "identity", InsightRefs: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Preview(ctx, tenant, plan.ID, "analyst", c.ID, 1)
	if err != nil || !r.Eligible || !r.DryRun || r.Steps[0].Outcome != "approval_required" || r.Steps[1].Outcome != "would_run" {
		t.Fatal(r, err)
	}
	if _, err = s.Preview(ctx, "foreign", plan.ID, "analyst", c.ID, 1); err == nil {
		t.Fatal("cross-tenant preview accepted")
	}
	if _, err = s.Preview(ctx, tenant, plan.ID, "analyst", "missing", 1); err == nil {
		t.Fatal("missing case accepted")
	}
	previews, err := s.Previews(ctx, tenant, plan.ID)
	if err != nil || len(previews) != 1 || previews[0].Actor != "analyst" {
		t.Fatal(previews, err)
	}
	current, err := cases.Get(ctx, tenant, c.ID)
	if err != nil || current.Status != "open" {
		t.Fatal("preview changed case", err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM case_records WHERE tenant_id=$1 AND investigation_id=$2 AND kind='remediations'`, tenant, c.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("preview created action", err)
	}
	// Workflow changes invalidate the pinned policy.
	plan.Input.Title = "Changed workflow"
	plan, err = s.Update(ctx, tenant, plan.ID, 1, plan.Input, "analyst")
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Preview(ctx, tenant, plan.ID, "analyst", c.ID, 2)
	if err != nil || r.Eligible {
		t.Fatal("stale policy eligible", r, err)
	}
	// Concurrent editors: exactly one version-1 policy update wins.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.SavePolicy(ctx, tenant, plan.ID, "analyst", 1, 2, p); results <- e }()
	}
	wg.Wait()
	close(results)
	wins := 0
	for e := range results {
		if e == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("concurrent policy writes", wins)
	}
	// An audit insert failure rolls back the policy write.
	_, err = pool.Exec(ctx, `INSERT INTO response_workflow_policy_history(tenant_id,plan_id,version,actor,document) VALUES($1,$2,3,'fixture','{}')`, tenant, plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SavePolicy(ctx, tenant, plan.ID, "analyst", 2, 2, p); err == nil {
		t.Fatal("audit failure ignored")
	}
	p, err = s.Policy(ctx, tenant, plan.ID)
	if err != nil || p.Version != 2 {
		t.Fatal("policy escaped rollback", p, err)
	}
	// Board status updates retain worker guards and optimistic concurrency.
	expected, _ := json.Marshal(c.UpdatedAt)
	fields := map[string]json.RawMessage{"status": json.RawMessage(`"investigating"`), "expected_updated_at": expected}
	if _, err = cases.Patch(ctx, tenant, c.ID, fields, []string{"status", "expected_updated_at"}); err != nil {
		t.Fatal(err)
	}
	if _, err = cases.Patch(ctx, tenant, c.ID, fields, []string{"status", "expected_updated_at"}); err == nil {
		t.Fatal("stale case write accepted")
	}
	plan, err = s.State(ctx, tenant, plan.ID, 2, "archived", "analyst")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SavePolicy(ctx, tenant, plan.ID, "analyst", 2, 3, p); err == nil {
		t.Fatal("archived policy write accepted")
	}
}
