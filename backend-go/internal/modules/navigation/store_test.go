package navigation

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestRejectInvalidLookupBeforeDatabase(t *testing.T) {
	for _, input := range [][2]string{{"unknown", "id"}, {"skills", ""}, {"skills", "bad\nname"}} {
		_, err := (Store{}).Label(context.Background(), "tenant", input[0], input[1])
		var f *fault.Error
		if !errors.As(err, &f) || f.Status != 400 {
			t.Fatalf("expected validation error, got %v", err)
		}
	}
}
func TestBreadcrumbLabelsTenantIsolation(t *testing.T) {
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
	tenant := "breadcrumb-" + jobs.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM detection_rules WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM threat_intel_reports WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM skills WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	for _, query := range []string{
		`INSERT INTO hunts(tenant_id,id,document,updated_at) VALUES($1,'hunt','{"name":"Evidence hunt"}',now())`,
		`INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'sparse','{"enabled":true}',now())`,
		`INSERT INTO skills(tenant_id,id,document,updated_at) VALUES($1,'skill','{"name":"<script>untrusted title</script>"}',now())`,
		`INSERT INTO threat_intel_reports(tenant_id,id,title,severity,published_at,created_at,updated_at) VALUES($1,'report','Threat report','high',now(),now(),now())`,
		`INSERT INTO investigations(tenant_id,id,title,source,severity,created_at,updated_at) VALUES($1,'case','Suspicious login','mock','high',now(),now())`,
	} {
		if _, err = pool.Exec(ctx, query, tenant); err != nil {
			t.Fatal(err)
		}
	}
	store := Store{Pool: pool}
	for _, fixture := range [][3]string{{"hunts", "hunt", "Evidence hunt"}, {"detection-rules", "sparse", "sparse"}, {"skills", "skill", "<script>untrusted title</script>"}, {"investigations", "case", "Suspicious login"}, {"threat-intel", "report", "Threat report"}} {
		label, err := store.Label(ctx, tenant, fixture[0], fixture[1])
		if err != nil || label != fixture[2] {
			t.Fatalf("label=%q err=%v", label, err)
		}
		for _, scope := range []string{tenant + "-foreign", tenant} {
			id := fixture[1]
			if scope == tenant {
				id = "missing"
			}
			_, err = store.Label(ctx, scope, fixture[0], id)
			var f *fault.Error
			if !errors.As(err, &f) || f.Status != 404 || f.Message != "Resource not found" {
				t.Fatalf("inconsistent missing response: %v", err)
			}
		}
	}
	if _, err = pool.Exec(ctx, `UPDATE skills SET document=jsonb_build_object('name',$2::text) WHERE tenant_id=$1`, tenant, strings.Repeat("x", 300)); err != nil {
		t.Fatal(err)
	}
	label, err := store.Label(ctx, tenant, "skills", "skill")
	if err != nil || len(label) != 160 {
		t.Fatalf("unbounded label: %d %v", len(label), err)
	}

}
