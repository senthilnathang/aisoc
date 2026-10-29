package eventstate

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
)

func setup(t *testing.T) (Store, telemetry.Binding, telemetry.Event) {
	t.Helper()
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal("repeat migration", err)
	}
	b := telemetry.Binding{TenantID: "stream-test-" + jobs.ID(), ConnectorID: "mock-qradar", Source: "qradar-siem"}
	if _, err := pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"stream_inbox", "stream_outbox", "stream_events", "stream_source_checkpoints", "jobs"} {
			if _, err := pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", b.TenantID); err != nil {
				t.Error(err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, b.TenantID); err != nil {
			t.Error(err)
		}
	})
	e := telemetry.Event{SchemaVersion: "1.0", EventID: "delivery-1", TenantID: b.TenantID, ConnectorID: b.ConnectorID, Source: b.Source, SourceEventID: "source-1", SourceRevision: "1", EventType: "authentication.failed", EventTime: "2026-10-29T10:00:00Z", IngestedAt: "2026-10-29T10:00:01Z", Severity: "medium", EvidenceRef: "mock-evidence:1", TraceID: "trace-1", Projection: telemetry.Projection{PrincipalRef: "mock-user", AssetRef: "mock-asset", SourceIP: "192.0.2.10"}}
	return Store{Pool: pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}, b, e
}

func accept(t *testing.T, s Store, b telemetry.Binding, cp Checkpoint, next string, events ...telemetry.Event) Accepted {
	t.Helper()
	r, err := s.Accept(context.Background(), b, cp, next, events)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func counts(t *testing.T, s Store, b telemetry.Binding, events, outbox, inbox int) {
	t.Helper()
	for table, want := range map[string]int{"stream_events": events, "stream_outbox": outbox, "stream_inbox": inbox} {
		var got int
		if err := s.Pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", b.TenantID).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("%s: got %d want %d", table, got, want)
		}
	}
}
func checkpoint(t *testing.T, s Store, b telemetry.Binding, want Checkpoint) {
	t.Helper()
	got, err := s.Checkpoint(context.Background(), b)
	if err != nil || got != want {
		t.Fatalf("checkpoint=%v want=%v err=%v", got, want, err)
	}
}

func TestAtomicAcceptanceReplayRevisionsAndBudgets(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	first := accept(t, s, b, Checkpoint{}, "page-1", e)
	if first.Inserted != 1 || first.Checkpoint.Version != 1 {
		t.Fatal(first)
	}
	retry := e
	retry.EventID = "redelivery"
	retry.TraceID = "another-trace"
	retry.IngestedAt = "2026-10-29T11:00:00Z"
	second := accept(t, s, b, first.Checkpoint, "page-2", retry)
	if second.Inserted != 0 {
		t.Fatal("redelivery duplicated envelope")
	}
	counts(t, s, b, 1, 1, 0)
	newEvent := e
	newEvent.SourceEventID = "source-2"
	conflict := e
	conflict.Projection.AssetRef = "changed"
	if _, err := s.Accept(ctx, b, second.Checkpoint, "page-3", []telemetry.Event{newEvent, conflict}); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	counts(t, s, b, 1, 1, 0)
	checkpoint(t, s, b, second.Checkpoint)
	if _, err := s.Accept(ctx, b, first.Checkpoint, "stale", []telemetry.Event{newEvent}); !errors.Is(err, ErrCheckpoint) {
		t.Fatal(err)
	}
	foreign := e
	foreign.TenantID = "foreign"
	if _, err := s.Accept(ctx, b, second.Checkpoint, "foreign", []telemetry.Event{foreign}); !errors.Is(err, telemetry.ErrBinding) {
		t.Fatal(err)
	}
	limited := s
	limited.MaxEvents = 1
	if _, err := limited.Accept(ctx, b, second.Checkpoint, "over-budget", []telemetry.Event{newEvent}); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	limited = s
	limited.MaxPayloadBytes = 1
	if _, err := limited.Accept(ctx, b, second.Checkpoint, "over-bytes", []telemetry.Event{newEvent}); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	counts(t, s, b, 1, 1, 0)
	checkpoint(t, s, b, second.Checkpoint)
	revision := e
	revision.SourceRevision = "2"
	third := accept(t, s, b, second.Checkpoint, "page-3", revision)
	if third.Inserted != 1 {
		t.Fatal("new revision lost")
	}
	counts(t, s, b, 2, 2, 0)
	// Duplicate identity inside a single source batch is also idempotent.
	fourth := accept(t, s, b, third.Checkpoint, "page-4", newEvent, newEvent)
	if fourth.Inserted != 1 {
		t.Fatal("batch duplicate created records")
	}
	counts(t, s, b, 3, 3, 0)
	// Disconnect/reopen the DB pool: the checkpoint and envelopes are durable.
	other, err := database.Open(ctx, os.Getenv("AISOC_GO_TEST_DATABASE_URL"), 2)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	reopened := s
	reopened.Pool = other
	checkpoint(t, reopened, b, fourth.Checkpoint)
}

func TestConcurrentAcceptanceHasOneCheckpointOwner(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Accept(ctx, b, Checkpoint{}, "page-1", []telemetry.Event{e})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, ErrCheckpoint) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("accepted %d competing checkpoints", success)
	}
	counts(t, s, b, 1, 1, 0)
}

func TestPublicationLeaseRecoveryAndFencing(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page-1", e)
	var wg sync.WaitGroup
	leases := make(chan *Lease, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			l, err := s.Claim(ctx, b)
			if err != nil {
				errs <- err
			}
			if l != nil {
				leases <- l
			}
		}()
	}
	wg.Wait()
	close(leases)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if len(leases) != 1 {
		t.Fatalf("claims=%d", len(leases))
	}
	old := <-leases
	foreign := b
	foreign.ConnectorID = "foreign"
	if err := s.MarkPublished(ctx, foreign, *old, "1-0"); !errors.Is(err, ErrLease) {
		t.Fatal("foreign mark", err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET lease_until=now()-interval '1 second' WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkPublished(ctx, b, *old, "1-0"); !errors.Is(err, ErrLease) {
		t.Fatal("expired mark", err)
	}
	// Model a publisher crash after XADD but before recording its acknowledgment.
	fresh, err := s.Claim(ctx, b)
	if err != nil || fresh == nil {
		t.Fatal("no replacement", err)
	}
	if old.AttemptID == fresh.AttemptID || old.EventKey != fresh.EventKey || old.ContentHash != fresh.ContentHash {
		t.Fatal("recovery identity changed")
	}
	if err := s.MarkPublished(ctx, b, *old, "1-0"); !errors.Is(err, ErrLease) {
		t.Fatal("stale mark", err)
	}
	if err := s.Retry(ctx, b, *old, time.Second); !errors.Is(err, ErrLease) {
		t.Fatal("stale retry", err)
	}
	if err := s.MarkPublished(ctx, b, *fresh, "2-0"); err != nil {
		t.Fatal(err)
	}
	if l, err := s.Claim(ctx, b); err != nil || l != nil {
		t.Fatal("published reclaimed", err)
	}
	// Successful publication must retain evidence/replay records.
	counts(t, s, b, 1, 1, 0)
}

func TestFailedPublicationIsRetainedAndBounded(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page-1", e)
	l, err := s.Claim(ctx, b)
	if err != nil || l == nil {
		t.Fatal(err)
	}
	if err := s.Retry(ctx, b, *l, time.Minute); err != nil {
		t.Fatal(err)
	}
	if next, err := s.Claim(ctx, b); err != nil || next != nil {
		t.Fatal("ignored retry delay", err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET available_at=now(),max_attempts=2 WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	l, err = s.Claim(ctx, b)
	if err != nil || l == nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET lease_until=now()-interval '1 second' WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	if next, err := s.Claim(ctx, b); err != nil || next != nil {
		t.Fatal("exhausted attempt reclaimed", err)
	}
	var state, code string
	if err := s.Pool.QueryRow(ctx, `SELECT state,error_code FROM stream_outbox WHERE tenant_id=$1`, b.TenantID).Scan(&state, &code); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || code != "ATTEMPTS_EXHAUSTED" {
		t.Fatal(state, code)
	}
	counts(t, s, b, 1, 1, 0)
}

func TestInboxAndEffectsCommitTogetherAndReplayOnce(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page-1", e)
	injected := errors.New("injected failure after job insert")
	_, err := s.Apply(ctx, b, "mock-correlator-v1", e.Identity(), e.ContentHash(), "finding", func(ctx context.Context, tx pgx.Tx, event telemetry.Event) error {
		if err := jobs.Enqueue(ctx, tx, event.TenantID, jobs.ID(), "python.normalize", []byte("fixture")); err != nil {
			return err
		}
		return injected
	})
	if !errors.Is(err, injected) {
		t.Fatal(err)
	}
	counts(t, s, b, 1, 1, 0)
	var n int
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE tenant_id=$1`, b.TenantID).Scan(&n); err != nil || n != 0 {
		t.Fatal("failed effect persisted", n, err)
	}
	effect := func(ctx context.Context, tx pgx.Tx, event telemetry.Event) error {
		return jobs.Enqueue(ctx, tx, event.TenantID, jobs.ID(), "python.normalize", []byte("fixture"))
	}
	var wg sync.WaitGroup
	results := make(chan bool, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			applied, err := s.Apply(ctx, b, "mock-correlator-v1", e.Identity(), e.ContentHash(), "finding", effect)
			results <- applied
			if err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	applied := 0
	for ok := range results {
		if ok {
			applied++
		}
	}
	if applied != 1 {
		t.Fatalf("effects applied %d times", applied)
	}
	counts(t, s, b, 1, 1, 1)
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE tenant_id=$1`, b.TenantID).Scan(&n); err != nil || n != 1 {
		t.Fatal("duplicate jobs", n, err)
	}
	// Fresh store models process restart and redelivery after commit but before ACK.
	restarted := Store{Pool: s.Pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}
	if ok, err := restarted.Apply(ctx, b, "mock-correlator-v1", e.Identity(), e.ContentHash(), "finding", effect); err != nil || ok {
		t.Fatal("replay repeated effect", err)
	}
	if _, err := s.Apply(ctx, b, "mock-correlator-v1", e.Identity(), e.ContentHash(), "filtered", effect); !errors.Is(err, ErrConflict) {
		t.Fatal("conflicting disposition", err)
	}
	changed := e
	changed.Projection.AssetRef = "changed"
	if _, err := s.Apply(ctx, b, "mock-correlator-v1", e.Identity(), changed.ContentHash(), "finding", effect); !errors.Is(err, ErrConflict) {
		t.Fatal("conflicting hash", err)
	}
	foreign := b
	foreign.TenantID = "foreign"
	if _, err := s.Apply(ctx, foreign, "mock-correlator-v1", e.Identity(), e.ContentHash(), "finding", effect); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign event", err)
	}
}
