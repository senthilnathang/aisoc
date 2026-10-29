package detection

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
)

func TestRuleAuditRollbackAndVersionCascade(t *testing.T) {
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
	tenant := "rule-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM detection_rules WHERE tenant_id=$1`, tenant)
	input := map[string]any{"name": "Original", "severity": "high"}
	r, err := s.Create(ctx, tenant, input)
	if err != nil {
		t.Fatal(err)
	}
	id := r["id"].(string)
	name := pgx.Identifier{"fail_rule_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	_, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Create(ctx, tenant, input); err == nil {
		t.Fatal("creation survived audit failure")
	}
	if _, err = s.Clone(ctx, tenant, id); err == nil {
		t.Fatal("clone survived audit failure")
	}
	if _, err = s.Update(ctx, tenant, id, map[string]any{"name": "Changed"}, []string{"name"}, 1, false); err == nil {
		t.Fatal("update survived audit failure")
	}
	if _, err = s.Update(ctx, tenant, id, nil, nil, 0, true); err == nil {
		t.Fatal("toggle survived audit failure")
	}
	if err = s.Delete(ctx, tenant, id); err == nil {
		t.Fatal("delete survived audit failure")
	}
	after, err := s.Detail(ctx, tenant, id)
	if err != nil {
		t.Fatal(err)
	}
	if after["name"] != "Original" || after["enabled"] != true || after["version"] != 1 || len(after["versions"].([]map[string]any)) != 1 {
		t.Fatal("partial mutation escaped", after)
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM detection_rules WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 1 {
		t.Fatal("partial creation escaped", n, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, tenant, id); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM detection_rule_versions WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 0 {
		t.Fatal("version cascade failed", n, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='detection_rules'`, tenant).Scan(&n); err != nil || n != 2 {
		t.Fatal("audit retention failed", n, err)
	}
}
