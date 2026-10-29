package jobs

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/platform/database"
	"context"
	"os"
	"sync"
	"testing"
)

func TestPostgresTransactionsLeasesAndIsolation(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal("migration repeat:", err)
	}
	tenant := "test-" + ID()
	_, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM jobs WHERE tenant_id=$1`, tenant)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rolledBack := ID()
	if err = Enqueue(ctx, tx, tenant, rolledBack, "rust.sha256", []byte("rollback")); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 0 {
		t.Fatal("rolled back job persisted", err)
	}
	tx, _ = pool.Begin(ctx)
	id := ID()
	if err = Enqueue(ctx, tx, tenant, id, "rust.sha256", []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	store := Store{Pool: pool, Plugins: []string{"rust.sha256"}}
	results := make(chan *pb.ExecuteRequest, 8)
	failures := make(chan error, 8)
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			r, err := store.Claim(ctx)
			if err != nil {
				failures <- err
			}
			if r != nil {
				results <- r
			}
		}()
	}
	group.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("claims=%d", len(results))
	}
	attempt := <-results
	foreign := &pb.ExecuteRequest{TenantId: "foreign", JobId: attempt.JobId, AttemptId: attempt.AttemptId}
	if err = store.Complete(ctx, foreign, []byte("spoofed")); err != ErrStale {
		t.Fatalf("foreign completion: %v", err)
	}
	_, err = pool.Exec(ctx, `UPDATE jobs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2`, tenant, id)
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := store.Claim(ctx)
	if err != nil || replacement == nil {
		t.Fatal("expired lease not recovered", err)
	}
	if replacement.AttemptId == attempt.AttemptId {
		t.Fatal("attempt identity reused")
	}
	if err = store.Complete(ctx, attempt, []byte("late")); err != ErrStale {
		t.Fatal("late completion accepted", err)
	}
	if err = store.Cancel(ctx, "foreign", id); err != ErrStale {
		t.Fatal("foreign cancellation accepted")
	}
	if err = store.Cancel(ctx, tenant, id); err != nil {
		t.Fatal(err)
	}
	if err = store.Complete(ctx, replacement, []byte("cancelled")); err != ErrStale {
		t.Fatal("cancelled result committed")
	}
}
