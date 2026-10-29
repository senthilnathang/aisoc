package response

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestAuditFailureRollsBackPlan(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store := Store{Pool: pool}
	tenant := "response-test-" + jobs.ID()
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM response_plans WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM response_plan_versions WHERE tenant_id=$1`, tenant)
	in := Input{Kind: "runbook", Title: "Original", Description: "Test", Domain: "Identity", Trigger: "Incident", Steps: []Step{{Title: "Review", Instructions: "Scope", ApprovalRequired: true}}}
	p, err := store.Create(ctx, tenant, in, "test")
	if err != nil {
		t.Fatal(err)
	}
	// Force an audit conflict after the plan UPDATE inside the transaction.
	_, err = pool.Exec(ctx, `INSERT INTO response_plan_versions(tenant_id,plan_id,version,snapshot,action,actor,created_at) SELECT tenant_id,id,2,document,'updated','conflict-fixture',now() FROM response_plans WHERE tenant_id=$1 AND id=$2`, tenant, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	in.Title = "Must roll back"
	if _, err = store.Update(ctx, tenant, p.ID, 1, in, "test"); err == nil {
		t.Fatal("expected audit conflict")
	}
	loaded, err := store.Get(ctx, tenant, p.ID)
	if err != nil || loaded.Title != "Original" || loaded.Version != 1 {
		t.Fatal("plan update escaped rollback", err)
	}
	if _, err = store.Get(ctx, "foreign", p.ID); err == nil {
		t.Fatal("cross-tenant read accepted")
	}
}
