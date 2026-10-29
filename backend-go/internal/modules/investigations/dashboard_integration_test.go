package investigations

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"sort"
	"testing"
)

func TestDashboardSnapshotAndTimestampTies(t *testing.T) {
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
	tenant := "dashboard-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	ids := []string{}
	for i := 0; i < 5; i++ {
		r, e := s.Create(ctx, tenant, Input{Title: "Snapshot", Source: "Fixture", Severity: "low", Status: "open", Determination: "unknown"})
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, r.ID)
	}
	sort.Strings(ids)
	if _, err = pool.Exec(ctx, `UPDATE investigations SET updated_at='2025-01-01T00:00:00Z' WHERE tenant_id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	result, err := s.Dashboard(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range result.RecentInvestigations {
		if r.ID != ids[i] {
			t.Fatal("unstable timestamp tie order")
		}
	}
	// Each writer commit changes every case together. A dashboard must never mix
	// the old totals with new recent-row statuses across its two SQL statements.
	writerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		for i := 0; i < 250; i++ {
			status := "open"
			if i%2 == 0 {
				status = "closed"
			}
			if _, e := pool.Exec(writerCtx, `UPDATE investigations SET status=$2 WHERE tenant_id=$1`, tenant, status); e != nil {
				done <- e
				return
			}
		}
		done <- nil
	}()
	defer func() { cancel(); <-done }()
	for i := 0; i < 100; i++ {
		r, e := s.Dashboard(ctx, tenant)
		if e != nil {
			t.Fatal(e)
		}
		if len(r.RecentInvestigations) != 5 {
			t.Fatal("missing rows")
		}
		status := r.RecentInvestigations[0].Status
		want := int64(0)
		if status == "open" {
			want = 5
		}
		if r.QueueItems != want || r.OpenInvestigations != want {
			t.Fatal("mixed count/row snapshots", r.QueueItems, r.OpenInvestigations, status)
		}
		for _, record := range r.RecentInvestigations {
			if record.Status != status {
				t.Fatal("mixed recent-row snapshots")
			}
		}
	}
	empty, err := s.Dashboard(ctx, tenant+"-foreign")
	if err != nil || empty.QueueItems != 0 || len(empty.RecentInvestigations) != 0 {
		t.Fatal("foreign tenant leaked", err)
	}
}
