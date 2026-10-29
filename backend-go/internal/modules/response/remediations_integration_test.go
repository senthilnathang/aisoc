package response

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func rawFields(v map[string]any) map[string]json.RawMessage {
	result := map[string]json.RawMessage{}
	for k, value := range v {
		result[k], _ = json.Marshal(value)
	}
	return result
}
func TestRemediationAtomicityAndParentConcurrency(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 6)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "remediation-" + jobs.ID()
	s := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	createCase := func() string {
		r, err := cases.Create(ctx, tenant, investigations.Input{Title: "Case", Source: "Test", Severity: "high", Status: "open", Determination: "unknown"})
		if err != nil {
			t.Fatal(err)
		}
		return r.ID
	}
	first, second := createCase(), createCase()
	fields := rawFields(map[string]any{"investigation_id": first, "title": "Simulate", "action_type": "isolate"})
	record, err := s.CreateRemediation(ctx, tenant, fields)
	if err != nil {
		t.Fatal(err)
	}
	id := record["id"].(string)
	name := pgx.Identifier{"fail_remediation_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	_, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateRemediation(ctx, tenant, fields); err == nil {
		t.Fatal("creation survived failed audit")
	}
	for _, op := range []string{"patch", "execute", "delete"} {
		if _, err = s.MutateRemediation(ctx, tenant, id, op, rawFields(map[string]any{"investigation_id": second, "title": "Changed"}), []string{"investigation_id", "title"}); err == nil {
			t.Fatal("mutation survived failed audit", op)
		}
	}
	if _, err = cases.Patch(ctx, tenant, first, rawFields(map[string]any{"title": "Changed"}), []string{"title"}); err == nil {
		t.Fatal("case patch survived failed audit")
	}
	after, err := s.Remediation(ctx, tenant, id)
	if err != nil || after["title"] != "Simulate" || after["investigation_id"] != first || after["executed_at"] != nil {
		t.Fatal("partial mutation escaped", after, err)
	}
	r, err := cases.Get(ctx, tenant, first)
	if err != nil || r.Title != "Case" {
		t.Fatal("partial case edit escaped", r, err)
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM remediations WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 1 {
		t.Fatal("partial creation escaped", n, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateRemediation(ctx, tenant+"-foreign", fields); err == nil {
		t.Fatal("foreign parent accepted")
	}
	// Reassign and execute concurrently: neither may overwrite the other's fields.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, err := s.MutateRemediation(ctx, tenant, id, "patch", rawFields(map[string]any{"investigation_id": second}), []string{"investigation_id"})
		errs <- err
	}()
	go func() {
		defer wg.Done()
		_, err := s.MutateRemediation(ctx, tenant, id, "execute", nil, nil)
		errs <- err
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	after, err = s.Remediation(ctx, tenant, id)
	if err != nil || after["status"] != "completed" || after["investigation_id"] != second {
		t.Fatal("lost concurrent update", after, err)
	}
	if err = cases.Delete(ctx, tenant, first); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Remediation(ctx, tenant, id); err != nil {
		t.Fatal("old parent delete removed moved action", err)
	}
	// Execution racing deletion must leave no orphan or unfinished transaction.
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = s.MutateRemediation(ctx, tenant, id, "execute", nil, nil) }()
	var deleteErr error
	go func() { defer wg.Done(); deleteErr = cases.Delete(ctx, tenant, second) }()
	wg.Wait()
	if deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM remediations WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 0 {
		t.Fatal("cascade failed", n, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='remediations'`, tenant).Scan(&n); err != nil || n < 3 {
		t.Fatal("audit retention failed", n, err)
	}
}
