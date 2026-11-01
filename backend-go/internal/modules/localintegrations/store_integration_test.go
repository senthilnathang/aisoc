package localintegrations

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestDraftRevisionSealReplayAndAuditRollback(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
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
	tenant := "profiles-" + jobs.ID()
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM local_integration_profiles WHERE tenant_id=$1`, tenant)
	raw, err := os.ReadFile("../../../../examples/scenarios/suspicious-login/events.json")
	if err != nil {
		t.Fatal(err)
	}
	d := Document{SchemaVersion: "1"}
	json.Unmarshal(raw, &d.Events)
	for i := range d.Events {
		d.Events[i].TenantID = tenant
	}
	s := Store{Pool: pool}
	id := "build-" + jobs.ID()
	p, err := s.Save(ctx, tenant, "actor", id, "grant", "Fixture", 0, d)
	if err != nil || p.Version != 1 {
		t.Fatal(p, err)
	}
	p, err = s.Save(ctx, tenant, "actor", id, "grant", "Fixture", 0, d)
	if err != nil || p.Version != 1 {
		t.Fatal("lost-create replay", p, err)
	}
	if _, err = s.Get(ctx, "foreign", id); err == nil {
		t.Fatal("foreign profile exposed")
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"First", "Second"} {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			_, err := s.Save(ctx, tenant, "actor", id, "grant", name, 1, d)
			results <- err
		}(name)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent overwrites", success)
	}
	p, err = s.Seal(ctx, tenant, "actor", id, "grant", 2)
	if err != nil || p.State != "sealed" {
		t.Fatal(p, err)
	}
	if _, err = s.Save(ctx, tenant, "actor", id, "grant", "Changed", 2, d); err == nil {
		t.Fatal("sealed edit accepted")
	}
	if _, err = s.Seal(ctx, tenant, "actor", id, "grant", 2); err != nil {
		t.Fatal("seal replay", err)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1`, tenant).Scan(&n)
	if n != 3 {
		t.Fatal("audit count", n)
	}
	_, err = pool.Exec(ctx, `CREATE OR REPLACE FUNCTION reject_local_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='local_integrations' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_local_profile_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_local_profile_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP TRIGGER IF EXISTS reject_local_profile_audit ON audit_events; DROP FUNCTION IF EXISTS reject_local_profile_audit()`)
	failed := "build-" + jobs.ID()
	if _, err = s.Save(ctx, tenant, "actor", failed, "grant", "Rejected", 0, d); err == nil {
		t.Fatal("audit failure ignored")
	}
	if _, err = s.Get(ctx, tenant, failed); err == nil {
		t.Fatal("partial save")
	}
}
