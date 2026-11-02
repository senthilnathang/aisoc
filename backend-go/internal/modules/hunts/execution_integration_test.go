package hunts

import (
	"aisoc/backend/internal/modules/hunts/huntsql"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"
	"time"
)

func TestDurableHuntRecoveryCancellationRetryAndPromotion(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, e := database.Open(ctx, url, 8)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if e = database.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	tenant := "durable-hunt-" + jobs.ID()
	s := Store{Pool: pool}
	w := NewHuntWorker(s, 1)
	defer func() {
		for _, table := range []string{"hunts", "investigations", "jobs", "audit_events", "tenants"} {
			column := "tenant_id"
			if table == "tenants" {
				column = "id"
			}
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE "+column+"=$1", tenant)
		}
	}()
	h, e := s.Mutate(ctx, tenant, "", "create", map[string]json.RawMessage{"name": json.RawMessage(`"Durable hunt"`), "query": json.RawMessage(`"192.0.2.72"`)}, nil)
	if e != nil {
		t.Fatal(e)
	}
	id, version := h["id"].(string), h["updated_at"].(string)
	// Quota serialization must not block foreign-key KEY SHARE from an audit writer.
	quotaTx, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = huntsql.New(quotaTx).LockHuntTenant(ctx, tenant); e != nil {
		t.Fatal(e)
	}
	auditCtx, auditCancel := context.WithTimeout(ctx, time.Second)
	auditTx, e := pool.Begin(auditCtx)
	if e != nil {
		t.Fatal(e)
	}
	e = investigations.ResourceAudit(auditCtx, auditTx, tenant, "hunts", id, "lock_compatibility", nil)
	auditTx.Rollback(ctx)
	auditCancel()
	quotaTx.Rollback(ctx)
	if e != nil {
		t.Fatalf("quota lock blocks audit foreign key: %v", e)
	}

	c, e := (investigations.Store{Pool: pool}).Create(ctx, tenant, investigations.Input{Title: "192.0.2.72 evidence", Source: "local-json", Severity: "high", Status: "open", Determination: "unknown", PrimaryEntity: "192.0.2.72", InsightRefs: []string{}})
	if e != nil {
		t.Fatal(e)
	}
	mustSQL := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	queue := func(key string) Execution {
		t.Helper()
		r, e := s.Queue(ctx, tenant, id, "analyst", key, version)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	a := queue("recover")
	if replay := queue("recover"); replay.JobID != a.JobID {
		t.Fatal("enqueue duplicated")
	}
	if _, e = s.Queue(ctx, tenant, id, "other", "recover", version); e == nil {
		t.Fatal("actor replay accepted")
	}
	if _, e = s.Queue(ctx, tenant+"-foreign", id, "analyst", "foreign", version); e == nil {
		t.Fatal("tenant escape")
	}
	if _, e = s.Queue(ctx, tenant, id, "analyst", "another", version); e == nil {
		t.Fatal("parallel hunt accepted")
	}
	if _, e = s.Search(ctx, tenant, id, "analyst", "recover", version); e == nil {
		t.Fatal("queued ID bypassed")
	}
	if _, e = s.Mutate(ctx, tenant, id, "delete", nil, nil); e == nil {
		t.Fatal("active hunt deleted")
	}
	old, e := w.Claim(ctx)
	if e != nil || old == nil {
		t.Fatalf("claim: %v", e)
	}
	output, e := w.Execute(ctx, old)
	if e != nil {
		t.Fatal(e)
	}
	// A new worker recovers the abandoned lease; the original process has no authority.
	mustSQL(`UPDATE jobs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2`, tenant, a.JobID)
	restarted := NewHuntWorker(s, 1)
	fresh, e := restarted.Claim(ctx)
	if e != nil || fresh == nil || fresh.AttemptId == old.AttemptId {
		t.Fatalf("recovery: %v", e)
	}
	if e = w.Complete(ctx, old, output); !errors.Is(e, jobs.ErrStale) {
		t.Fatalf("stale output: %v", e)
	}
	output, e = restarted.Execute(ctx, fresh)
	if e != nil {
		t.Fatal(e)
	}

	// Audit failure must roll back the receipt and job completion together.
	mustSQL(`CREATE FUNCTION hunt_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='local_search' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER hunt_test_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hunt_test_audit_fail()`)
	if e = restarted.Complete(ctx, fresh, output); e == nil {
		t.Fatal("audit failure accepted")
	}
	mustSQL(`DROP TRIGGER hunt_test_audit_fail ON audit_events; DROP FUNCTION hunt_test_audit_fail()`)
	before, e := s.Workspace(ctx, tenant, id)
	if e != nil || len(before.Runs) != 0 || before.Executions[0].State != "running" {
		t.Fatal("partial completion after audit failure", e)
	}
	if e = restarted.Complete(ctx, fresh, output); e != nil {
		t.Fatal(e)
	}
	if e = restarted.Complete(ctx, fresh, output); !errors.Is(e, jobs.ErrStale) {
		t.Fatal("duplicate completion")
	}
	workspace, e := s.Workspace(ctx, tenant, id)
	if e != nil || len(workspace.Runs) != 1 || workspace.Executions[0].State != "completed" {
		t.Fatalf("receipt: %+v %v", workspace, e)
	}
	run := workspace.Runs[0]
	if len(run.Findings) != 1 || run.Findings[0].CaseID != c.ID {
		t.Fatalf("evidence: %+v", run)
	}
	// Concurrent promotion and replay share one durable receipt and investigation.
	var wg sync.WaitGroup
	results := make(chan string, 4)
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, e := s.Promote(ctx, tenant, id, "analyst", PromoteInput{RunID: run.ID, RecordID: c.ID, Kind: "case", Comment: "Reviewed local evidence for investigation", Confirm: true})
			results <- p.InvestigationID
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
	promoted := ""
	for result := range results {
		if promoted != "" && result != promoted {
			t.Fatal("duplicate investigation")
		}
		promoted = result
	}
	// Running cancellation wins over computed but uncommitted evidence.
	b := queue("cancel")
	request, e := w.Claim(ctx)
	if e != nil || request == nil {
		t.Fatal(e)
	}
	out, e := w.Execute(ctx, request)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ControlExecution(ctx, tenant, id, "analyst", b.ID, "cancel", 0); e != nil {
		t.Fatal(e)
	}
	if e = w.Complete(ctx, request, out); !errors.Is(e, jobs.ErrStale) {
		t.Fatal("cancelled result committed", e)
	}
	if _, e = s.Search(ctx, tenant, id, "analyst", b.ID, version); e == nil {
		t.Fatal("cancel bypass")
	}
	if _, e = s.ControlExecution(ctx, tenant, id, "analyst", b.ID, "retry", 0); e == nil {
		t.Fatal("cancelled retry")
	}
	// Queued cancellation and foreign control are also guarded.
	q := queue("queued-cancel")
	if _, e = s.ControlExecution(ctx, tenant+"-foreign", id, "analyst", q.ID, "cancel", 0); e == nil {
		t.Fatal("foreign control")
	}
	if _, e = s.ControlExecution(ctx, tenant, id, "analyst", q.ID, "cancel", 0); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ControlExecution(ctx, tenant, id, "analyst", q.ID, "cancel", 0); e != nil {
		t.Fatal("cancel replay", e)
	}
	// Fail all automatic attempts; explicit extensions preserve identity and are bounded.
	retry := queue("retry")
	for attempt := int32(1); attempt <= 9; attempt++ {
		req, e := w.Claim(ctx)
		if e != nil || req == nil {
			t.Fatalf("attempt %d claim: %v", attempt, e)
		}
		if e = w.Retry(ctx, req); e != nil {
			t.Fatal(e)
		}
		mustSQL(`UPDATE jobs SET available_at=now() WHERE tenant_id=$1 AND id=$2`, tenant, retry.JobID)
		if attempt%3 == 0 && attempt < 9 {
			extended, e := s.ControlExecution(ctx, tenant, id, "analyst", retry.ID, "retry", attempt)
			if e != nil {
				t.Fatal(e)
			}
			replay, e := s.ControlExecution(ctx, tenant, id, "analyst", retry.ID, "retry", attempt)
			if e != nil || replay.MaxAttempts != extended.MaxAttempts {
				t.Fatal("retry extension duplicated", e)
			}
		}
	}
	if _, e = s.ControlExecution(ctx, tenant, id, "analyst", retry.ID, "retry", 9); e == nil {
		t.Fatal("unbounded retry")
	}
	workspace, e = s.Workspace(ctx, tenant, id)
	if e != nil || len(workspace.Runs) != 1 {
		t.Fatal("failed/cancelled receipt persisted", e)
	}
}
