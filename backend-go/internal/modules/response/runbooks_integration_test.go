package response

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
)

func TestRunbookAuditRollbackAndCascade(t *testing.T) {
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
	tenant := "runbook-test-" + jobs.ID()
	store := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM response_plans WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM response_plan_versions WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	record, err := cases.Create(ctx, tenant, investigations.Input{Title: "Case", Source: "Test", Category: "other", Severity: "high", Status: "open", Determination: "unknown", Owner: "Analyst"})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := store.Create(ctx, tenant, Input{Kind: "runbook", Title: "Plan", Description: "Review", Domain: "Identity", Trigger: "Incident", Steps: []Step{{Title: "Review", Instructions: "Approve", ApprovalRequired: true}}}, "test")
	if err != nil {
		t.Fatal(err)
	}
	assignment, err := store.Attach(ctx, tenant, record.ID, plan.ID, 1, "test")
	if err != nil {
		t.Fatal(err)
	}
	// Fail the final write, after assignment and per-runbook event updates, for this tenant only.
	name := "fail_audit_" + strings.ReplaceAll(jobs.ID(), "-", "")
	quoted := pgx.Identifier{name}.Sanitize()
	_, err = pool.Exec(ctx, `CREATE FUNCTION `+quoted+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='runbook_step_completed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+quoted+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+quoted+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+quoted+`() `); err != nil {
		t.Fatal(err)
	}
	update := StepInput{ExpectedVersion: 1, StepIndex: 0, Completed: true, Note: "Approved", ApprovalConfirmed: true}
	if _, err = store.Step(ctx, tenant, record.ID, assignment.ID, update, "test"); err == nil {
		t.Fatal("expected case-audit failure")
	}
	list, err := store.Assignments(ctx, tenant, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Version != 1 || list[0].Steps[0].Completed || len(list[0].History) != 1 {
		t.Fatal("partial runbook update escaped rollback")
	}
	audit, err := cases.History(ctx, tenant, record.ID)
	if err != nil || len(audit) != 2 {
		t.Fatal("unexpected case audit after rollback", err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+quoted+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Step(ctx, tenant, record.ID, assignment.ID, update, "test"); err != nil {
		t.Fatal(err)
	}
	// Foreign keys independently reject an assignment to a case in another tenant.
	if _, err = pool.Exec(ctx, `INSERT INTO case_runbooks(tenant_id,id,investigation_id,plan_id,document) VALUES('foreign',$1,$2,$3,'{}')`, jobs.ID(), record.ID, plan.ID); err == nil {
		t.Fatal("cross-tenant database link accepted")
	}
	if err = cases.Delete(ctx, tenant, record.ID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"case_runbooks", "case_runbook_events"} {
		var n int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 0 {
			t.Fatalf("cascade left %s rows: %d %v", table, n, err)
		}
	}
	if _, err = store.Get(ctx, tenant, plan.ID); err != nil {
		t.Fatal("case delete removed reusable plan", err)
	}
	var audits int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1`, tenant).Scan(&audits); err != nil || audits != 4 {
		t.Fatal("audit trail was not retained", audits, err)
	}
}
