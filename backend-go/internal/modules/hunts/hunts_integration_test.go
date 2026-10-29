package hunts

import (
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

func TestMutationRollbackConcurrencyAndAuditRetention(t *testing.T) {
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
	tenant := "hunts-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1`, tenant)
	raw := func(v map[string]any) map[string]json.RawMessage {
		result := map[string]json.RawMessage{}
		for k, v := range v {
			result[k], _ = json.Marshal(v)
		}
		return result
	}
	input := raw(map[string]any{"name": "Hunt", "query": "opaque query"})
	record, err := s.Mutate(ctx, tenant, "", "create", input, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := record["id"].(string)
	name := pgx.Identifier{"fail_hunt_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	_, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"create", "patch", "run", "delete"} {
		if _, err = s.Mutate(ctx, tenant, id, op, input, []string{"name", "query"}); err == nil {
			t.Fatal("mutation survived audit failure", op)
		}
	}
	after, err := s.Detail(ctx, tenant, id)
	if err != nil || after["status"] != "draft" || after["last_run_at"] != nil || after["name"] != "Hunt" {
		t.Fatal("partial write escaped", after, err)
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM hunts WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 1 {
		t.Fatal("partial create escaped", n, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); _, e := s.Mutate(ctx, tenant, id, "run", nil, nil); errs <- e }()
	go func() {
		defer wg.Done()
		_, e := s.Mutate(ctx, tenant, id, "patch", raw(map[string]any{"name": "Edited", "query": "new query"}), []string{"query", "name"})
		errs <- e
	}()
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	after, err = s.Detail(ctx, tenant, id)
	if err != nil || after["status"] != "completed" || after["name"] != "Edited" || after["query"] != "new query" {
		t.Fatal("lost concurrent edit/run", after, err)
	}
	// Ignored fields still audit incoming key order, but do not change updated_at.
	unchanged, err := s.Mutate(ctx, tenant, id, "patch", raw(map[string]any{"ignored": true}), []string{"ignored", "secret"})
	if err != nil || unchanged["updated_at"] != after["updated_at"] {
		t.Fatal("ignored field changed record", unchanged, err)
	}
	var keys []string
	if err = pool.QueryRow(ctx, `SELECT details->'fields' FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 ORDER BY ordinal DESC LIMIT 1`, tenant, id).Scan(&keys); err != nil || len(keys) != 1 || keys[0] != "ignored" {
		t.Fatal("audit field filtering", keys, err)
	}
	for _, op := range []string{"patch", "run", "delete"} {
		if _, err = s.Mutate(ctx, tenant+"-foreign", id, op, nil, nil); err == nil {
			t.Fatal("cross-tenant mutation", op)
		}
	}
	if _, err = s.Mutate(ctx, tenant, id, "patch", raw(map[string]any{"findings_count": 2147483648}), nil); err == nil {
		t.Fatal("overflow accepted")
	}
	wg.Add(2)
	var deleteErr error
	go func() { defer wg.Done(); _, _ = s.Mutate(ctx, tenant, id, "run", nil, nil) }()
	go func() { defer wg.Done(); _, deleteErr = s.Mutate(ctx, tenant, id, "delete", nil, nil) }()
	wg.Wait()
	if deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if _, err = s.Detail(ctx, tenant, id); err == nil {
		t.Fatal("deleted hunt resurrected")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='hunts' AND resource_id=$2`, tenant, id).Scan(&n); err != nil || n < 5 {
		t.Fatal("audit lost on delete", n, err)
	}
}
