package jobs

import (
	"aisoc/backend/migrations"
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
	"time"
)

// A writer that began before the migration must not leave its first tenant job
// invisible to the new dispatcher. CREATE TRIGGER must fence writes before backfill.
func TestDispatchUpgradeIncludesConcurrentWriter(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	setup, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer setup.Close(context.Background())
	schema := pgx.Identifier{"job_upgrade_" + strings.ReplaceAll(ID(), "-", "")}.Sanitize()
	if _, err = setup.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer setup.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	if _, err = setup.Exec(ctx, "SET search_path TO "+schema); err != nil {
		t.Fatal(err)
	}
	baseline, _ := migrations.Files.ReadFile("001_framework.sql")
	if _, err = setup.Exec(ctx, string(baseline)); err != nil {
		t.Fatal(err)
	}
	if _, err = setup.Exec(ctx, `INSERT INTO tenants(id) VALUES('existing'),('concurrent')`); err != nil {
		t.Fatal(err)
	}
	if _, err = setup.Exec(ctx, `INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES('existing',$1,'rust.sha256','1','')`, ID()); err != nil {
		t.Fatal(err)
	}
	writer, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close(context.Background())
	if _, err = writer.Exec(ctx, "SET search_path TO "+schema); err != nil {
		t.Fatal(err)
	}
	tx, err := writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES('concurrent',$1,'rust.sha256','1','')`, ID()); err != nil {
		t.Fatal(err)
	}
	migrator, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer migrator.Close(context.Background())
	if _, err = migrator.Exec(ctx, "SET search_path TO "+schema); err != nil {
		t.Fatal(err)
	}
	data, _ := migrations.Files.ReadFile("031_job_dispatch.sql")
	done := make(chan error, 1)
	go func() { _, e := migrator.Exec(ctx, string(data)); done <- e }()
	// Wait for DDL to be blocked by the pre-existing INSERT transaction.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if err = setup.QueryRow(ctx, `SELECT coalesce(wait_event_type='Lock',false) FROM pg_stat_activity WHERE pid=$1`, migrator.PgConn().PID()).Scan(&waiting); err != nil {
			cancel()
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("migration did not wait for writer")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = tx.Commit(ctx); err != nil {
		cancel()
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	var count int
	if err = setup.QueryRow(ctx, `SELECT count(*) FROM job_dispatch_tenants`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("upgrade lost concurrent tenant: registered=%d, want 2", count)
	}
}
