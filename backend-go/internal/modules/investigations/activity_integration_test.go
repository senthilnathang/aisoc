package investigations

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
)

func TestActivityAtomicityAndCascade(t *testing.T) {
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
	tenant := "activity-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	r, err := s.Create(ctx, tenant, Input{Title: "Atomicity", Source: "Test", Severity: "high", Status: "open", Determination: "unknown"})
	if err != nil {
		t.Fatal(err)
	}
	name := pgx.Identifier{"fail_activity_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	_, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	// Batched writes must still roll back when the later audit insert fails,
	// and must release batch results so the connection can be reused.
	if _, err = s.Create(ctx, tenant, Input{Title: "Must roll back", Source: "Test", Severity: "high", Status: "open", Determination: "unknown"}); err == nil {
		t.Fatal("create escaped audit failure")
	}
	if _, err = s.Patch(ctx, tenant, r.ID, map[string]json.RawMessage{"primary_entity": json.RawMessage(`"must-roll-back"`)}, []string{"primary_entity"}); err == nil {
		t.Fatal("patch escaped audit failure")
	}
	var cases int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM investigations WHERE tenant_id=$1`, tenant).Scan(&cases); err != nil || cases != 1 {
		t.Fatal("batched create partially committed", cases, err)
	}
	for _, kind := range []string{"feedback", "artifacts"} {
		if _, err = s.AddRecord(ctx, tenant, r.ID, kind, map[string]any{"value": "test"}); err == nil {
			t.Fatal("expected audit failure")
		}
	}
	if _, err = s.Reinvestigate(ctx, tenant, r.ID); err == nil {
		t.Fatal("expected audit failure")
	}
	if _, err = s.Determine(ctx, tenant, r.ID, "malicious"); err == nil {
		t.Fatal("expected audit failure")
	}
	after, err := s.Get(ctx, tenant, r.ID)
	if err != nil || after.ReplayCount != 0 || after.Status != "open" || after.Determination != "unknown" || after.PrimaryEntity != r.PrimaryEntity {
		t.Fatal("partial outcome escaped rollback", after, err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM case_records WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial record escaped rollback", count, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddRecord(ctx, tenant, r.ID, "feedback", map[string]any{"comment": "Retained audit"}); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES('foreign',$1,$2,'feedback','{}',now(),now())`, jobs.ID(), r.ID); err == nil {
		t.Fatal("cross-tenant foreign key accepted")
	}
	if err = s.Delete(ctx, tenant, r.ID); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM case_records WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 0 {
		t.Fatal("cascade failed", count, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 3 {
		t.Fatal("audit retention failed", count, err)
	}
}
