package localintegrations

import (
	"aisoc/backend/internal/modules/localintegrations/localsql"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
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
	// A sealed profile with unfinished work cannot be hidden by archive.
	if _, err = s.Archive(ctx, tenant, "actor", id, 2); err == nil {
		t.Fatal("unfinished profile archived")
	}
	cloneID := "build-" + jobs.ID()
	clone, err := s.Clone(ctx, tenant, "actor", id, 2, cloneID, "Copy")
	if err != nil || clone.State != "draft" || clone.Version != 1 || clone.Document.Events[0].ConnectorID != cloneID {
		t.Fatal("clone", clone, err)
	}
	if _, err = s.Clone(ctx, tenant, "actor", id, 1, "build-"+jobs.ID(), "Stale"); err == nil {
		t.Fatal("stale clone allowed")
	}
	if _, err = s.Clone(ctx, "foreign", "actor", id, 2, "build-"+jobs.ID(), "Foreign"); err == nil {
		t.Fatal("foreign clone allowed")
	}
	replay, err := s.Clone(ctx, tenant, "actor", id, 2, cloneID, "Copy")
	if err != nil || replay.ID != cloneID {
		t.Fatal("clone retry", replay, err)
	}
	archived, err := s.Archive(ctx, tenant, "actor", cloneID, 1)
	if err != nil || archived.State != "archived" || archived.Version != 2 {
		t.Fatal("archive", archived, err)
	}
	if _, err = s.Archive(ctx, tenant, "actor", cloneID, 1); err != nil {
		t.Fatal("archive retry", err)
	}
	if _, err = s.Seal(ctx, tenant, "actor", cloneID, "grant", 2); err == nil {
		t.Fatal("archived import allowed")
	}
	if _, err = s.Save(ctx, tenant, "actor", cloneID, "grant", "Edit", 2, d); err == nil {
		t.Fatal("archived edit allowed")
	}
	history, err := s.History(ctx, tenant, cloneID)
	if err != nil || len(history) != 2 {
		t.Fatal("revision history", history, err)
	}
	// A partially processed snapshot must not be admitted for correlation.
	partialID := "build-" + jobs.ID()
	partial, err := s.Save(ctx, tenant, "actor", partialID, "grant", "Partial intake", 0, d)
	if err != nil {
		t.Fatal(err)
	}
	binding := Binding(tenant, partialID)
	intake := eventstate.Store{Pool: pool, MaxEvents: 1000, MaxPayloadBytes: 16 << 20}
	cp, err := intake.Checkpoint(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = intake.Accept(ctx, binding, cp, "snapshot-test", partial.Document.Events); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM stream_source_checkpoints WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM stream_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM stream_outbox WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM stream_inbox WHERE tenant_id=$1`, tenant)
	for i, event := range partial.Document.Events {
		ready, e := localsql.New(pool).ProfileSnapshotReady(ctx, localsql.ProfileSnapshotReadyParams{TenantID: tenant, ID: partialID})
		if e != nil || ready.Bool {
			t.Fatal("partial snapshot ready", i, ready, e)
		}
		if _, e = pool.Exec(ctx, `INSERT INTO stream_inbox(tenant_id,connector_id,source,processor,event_key,content_hash,disposition) VALUES($1,$2,'qradar-siem','build-login-v1',$3,$4,'filtered')`, tenant, partialID, event.Identity(), event.ContentHash()); e != nil {
			t.Fatal(e)
		}
	}
	ready, err := localsql.New(pool).ProfileSnapshotReady(ctx, localsql.ProfileSnapshotReadyParams{TenantID: tenant, ID: partialID})
	if err != nil || !ready.Valid || !ready.Bool {
		t.Fatal("complete snapshot not ready", ready, err)
	}
	auditDraft := "build-" + jobs.ID()
	if _, err = s.Save(ctx, tenant, "actor", auditDraft, "grant", "Audit rollback", 0, d); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `CREATE OR REPLACE FUNCTION reject_local_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='local_integrations' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_local_profile_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_local_profile_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP TRIGGER IF EXISTS reject_local_profile_audit ON audit_events; DROP FUNCTION IF EXISTS reject_local_profile_audit()`)
	if _, err = s.Archive(ctx, tenant, "actor", auditDraft, 1); err == nil {
		t.Fatal("archive audit failure ignored")
	}
	remaining, err := s.Get(ctx, tenant, auditDraft)
	if err != nil || remaining.State != "draft" || remaining.Version != 1 {
		t.Fatal("partial archive", remaining, err)
	}
	failedClone := "build-" + jobs.ID()
	if _, err = s.Clone(ctx, tenant, "actor", id, 2, failedClone, "Rejected clone"); err == nil {
		t.Fatal("clone audit failure ignored")
	}
	if _, err = s.Get(ctx, tenant, failedClone); err == nil {
		t.Fatal("partial clone")
	}
	failed := "build-" + jobs.ID()
	if _, err = s.Save(ctx, tenant, "actor", failed, "grant", "Rejected", 0, d); err == nil {
		t.Fatal("audit failure ignored")
	}
	if _, err = s.Get(ctx, tenant, failed); err == nil {
		t.Fatal("partial save")
	}
}
