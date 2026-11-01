package investigations

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestResponseSummaryAcrossPagesAndTenantIsolation(t *testing.T) {
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
	tenant := "response-summary-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM remediations WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM response_plans WHERE tenant_id=$1`, tenant)
	c, err := s.Create(ctx, tenant, Input{Title: "Summary case", Source: "Fixture", Severity: "low", Status: "open", Determination: "unknown"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO remediations(tenant_id,id,investigation_id,document,updated_at) SELECT $1,'action-'||n,$2,jsonb_build_object('id','action-'||n,'investigation_id',$2::text,'title','Action '||n,'status',CASE WHEN n=0 THEN 'pending' ELSE 'completed' END),now()+n*interval '1 second' FROM generate_series(0,125) n`, tenant, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO response_plans(tenant_id,id,document) VALUES($1,'workflow','{"kind":"workflow","state":"active"}')`, tenant)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.ResponseSummary(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	if result["pending"] != int64(1) || result["completed"] != int64(125) || result["cases"] != int64(1) || result["workflows"] != int64(1) {
		t.Fatal(result)
	}
	rows, err := RemediationRecords(ctx, pool, tenant, "", "pending", "", 25, 0)
	if err != nil || len(rows) != 1 || rows[0]["id"] != "action-0" {
		t.Fatal(rows, err)
	}
	result, err = s.ResponseSummary(ctx, tenant+"foreign")
	if err != nil || result["pending"] != int64(0) || result["cases"] != int64(0) || result["workflows"] != int64(0) {
		t.Fatal(result, err)
	}
}
