package eventstate

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
)

func TestVerifiedArchiveCompactionRollbackAndReplay(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accepted := accept(t, s, b, Checkpoint{}, "page", e)
	t.Cleanup(func() {
		for _, table := range []string{"stream_consumer_work", "audit_events"} {
			if _, err := s.Pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", b.TenantID); err != nil {
				t.Error(err)
			}
		}
	})
	w, err := s.BeginWork(ctx, b, "test", "event:"+e.Identity(), "1000-1", 3, 10)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Apply(ctx, b, "test", e.Identity(), e.ContentHash(), "filtered", func(ctx context.Context, tx pgx.Tx, e telemetry.Event) error {
		if err := FenceWork(ctx, tx, b, "test", w); err != nil {
			return err
		}
		return CompleteWork(ctx, tx, b, "test", w)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE stream_events SET created_at=now()-interval '8 days' WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	actor := auth.Principal{ID: "archivist", Tenant: b.TenantID}
	o := OperatorRecovery{Store: s, Grants: []RecoveryGrant{{Operator: actor, Binding: b}}}
	dir := t.TempDir()
	name := "archive_fail_" + strings.ReplaceAll(jobs.ID(), "-", "")
	if _, err = s.Pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+b.TenantID+`' AND NEW.action='stream_archive_verified' THEN RAISE EXCEPTION 'test archive audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := s.Pool.Exec(ctx, `DROP FUNCTION `+name+`() CASCADE`); err != nil {
			t.Error(err)
		}
	})
	if _, err = s.Pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = o.ArchiveCompleted(ctx, actor, b, "test", "", dir, 7*24*time.Hour); err == nil {
		t.Fatal("audit failure accepted")
	}
	var n int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM stream_consumer_work WHERE tenant_id=$1`, b.TenantID).Scan(&n); err != nil || n != 1 {
		t.Fatal("compaction escaped rollback", n, err)
	}
	if _, err = s.Pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	receipt, err := o.ArchiveCompleted(ctx, actor, b, "test", "", dir, 7*24*time.Hour)
	if err != nil || receipt.Events != 1 || receipt.CompactedWork != 1 {
		t.Fatal(receipt, err)
	}
	bundle, err := VerifyArchive(receipt.File, receipt.SHA256)
	if err != nil || len(bundle.Events) != 1 || bundle.Events[0].ContentHash != e.ContentHash() {
		t.Fatal(bundle, err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT retained_records FROM stream_metadata_budgets WHERE tenant_id=$1 AND processor='test'`, b.TenantID).Scan(&n); err != nil || n != 0 {
		t.Fatal(n, err)
	}
	checkpoint(t, s, b, accepted.Checkpoint)
	counts(t, s, b, 1, 1, 1)
	w, err = s.BeginWork(ctx, b, "test", "event:"+e.Identity(), "1000-2", 3, 10)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := s.Apply(ctx, b, "test", e.Identity(), e.ContentHash(), "filtered", func(context.Context, pgx.Tx, telemetry.Event) error {
		t.Fatal("duplicate effect after compaction")
		return nil
	})
	if err != nil || applied {
		t.Fatal(applied, err)
	}
	if err = s.FinishReplay(ctx, b, "test", w); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(receipt.File, []byte("corrupted"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyArchive(receipt.File, receipt.SHA256); err == nil {
		t.Fatal("corrupt archive verified")
	}
}
