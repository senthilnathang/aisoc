package hunts

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestLocalHuntEvidenceIsolationReplayAndNotes(t *testing.T) {
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
	tenant := "local-hunt-" + jobs.ID()
	s := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	defer func() {
		pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	h, err := s.Mutate(ctx, tenant, "", "create", map[string]json.RawMessage{"name": json.RawMessage(`"Local hunt"`), "query": json.RawMessage(`"192.0.2.42"`)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := h["id"].(string)
	expected := h["updated_at"].(string)
	c, err := cases.Create(ctx, tenant, investigations.Input{Title: "Suspicious login", Source: "IAM", Summary: "Login from 192.0.2.42 requires review", PrimaryEntity: "analyst@example.test", Category: "identity", Severity: "high", Status: "open", Determination: "unknown", InsightRefs: []string{}})
	if err != nil {
		t.Fatal(err)
	}

	_, err = pool.Exec(ctx, `INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES($1,'artifact',$2,'artifacts','{"type":"ip","label":"Login address","value":"192.0.2.42"}',now(),now())`, tenant, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	foreignTenant := tenant + "-foreign"
	_, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, foreignTenant)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, foreignTenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, foreignTenant)
	_, err = pool.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,source,severity,created_at,updated_at) VALUES($1,'foreign-case','192.0.2.42','foreign','high',now(),now())`, foreignTenant)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan Run, 2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Search(ctx, tenant, id, "analyst", "same-request", expected)
			results <- r
			errs <- e
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	for r := range results {
		if len(r.Findings) != 2 || r.Findings[0].CaseID != c.ID || r.Verdict != "review_required" {
			t.Fatal(r)
		}
	}
	w, err := s.Workspace(ctx, tenant, id)
	if err != nil || len(w.Runs) != 1 {
		t.Fatal(w, err)
	}
	if _, err = s.Workspace(ctx, "foreign", id); err == nil {
		t.Fatal("cross-tenant workspace")
	}
	if _, err = s.Search(ctx, "foreign", id, "analyst", "foreign", expected); err == nil {
		t.Fatal("cross-tenant search")
	}
	if _, err = s.Search(ctx, tenant, id, "another-actor", "same-request", expected); err == nil {
		t.Fatal("request identity collision")
	}
	if _, err = s.Search(ctx, tenant, id, "analyst", "stale", "old"); err == nil {
		t.Fatal("stale query accepted")
	}
	for i := 0; i < 2; i++ {
		if err = s.AddNote(ctx, tenant, id, "analyst", "note-1", "Treat logs as untrusted evidence."); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.AddNote(ctx, tenant, id, "analyst", "note-1", "changed"); err == nil {
		t.Fatal("changed note replay")
	}
	if err = s.AddNote(ctx, "foreign", id, "analyst", "note-1", "foreign"); err == nil {
		t.Fatal("cross-tenant note")
	}
	w, err = s.Workspace(ctx, tenant, id)
	if err != nil || len(w.Notes) != 1 || w.Notes[0].Actor != "analyst" {
		t.Fatal(w, err)
	}
	// Wildcard-looking content is a literal phrase, not SQL or an ILIKE wildcard.
	h, err = s.Mutate(ctx, tenant, id, "patch", map[string]json.RawMessage{"query": json.RawMessage(`"%_'; SELECT *"`)}, []string{"query"})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Search(ctx, tenant, id, "analyst", "literal", h["updated_at"].(string))
	if err != nil || len(r.Findings) != 0 || r.Verdict != "inconclusive" {
		t.Fatal(r, err)
	}
	// A receipt and its audit are atomic; induce audit failure without changing the runtime.
	constraint := "hunt_test_" + id[5:]
	_, err = pool.Exec(ctx, `ALTER TABLE audit_events ADD CONSTRAINT `+constraint+` CHECK (resource_id <> '`+id+`' OR action <> 'local_search') NOT VALID`)
	if err != nil {
		t.Fatal(err)
	}
	_, runErr := s.Search(ctx, tenant, id, "analyst", "rollback", h["updated_at"].(string))
	_, dropErr := pool.Exec(ctx, `ALTER TABLE audit_events DROP CONSTRAINT `+constraint)
	if runErr == nil || dropErr != nil {
		t.Fatal(runErr, dropErr)
	}
	w, err = s.Workspace(ctx, tenant, id)
	if err != nil || len(w.Runs) != 2 {
		t.Fatal("receipt escaped rollback", w, err)
	}
	h, err = s.Mutate(ctx, tenant, id, "patch", map[string]json.RawMessage{"query": json.RawMessage(`"bounded-match"`)}, []string{"query"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,source,severity,created_at,updated_at) SELECT $1,'bulk-'||n,'bounded-match','fixture','low',now(),now() FROM generate_series(1,105) n`, tenant)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Search(ctx, tenant, id, "analyst", "bounded", h["updated_at"].(string))
	if err != nil || len(r.Findings) != 100 || !r.Truncated {
		t.Fatal("result cap failed", r, err)
	}

}
