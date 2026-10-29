package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"testing"
)

func TestFreshBatchAtomicityBudgetAndReplay(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	second := e
	second.SourceEventID = "second"
	accept(t, s, b, Checkpoint{}, "page", e, second)
	t.Cleanup(func() {
		if _, err := s.Pool.Exec(ctx, `DELETE FROM stream_consumer_work WHERE tenant_id=$1`, b.TenantID); err != nil {
			t.Error(err)
		}
	})
	input := []BatchEvent{{e.Identity(), e.ContentHash()}, {second.Identity(), second.ContentHash()}}
	noop := func(context.Context, pgx.Tx, telemetry.Event) error { return nil }
	if _, err := s.ApplyFreshBatch(ctx, b, "batch", input, "filtered", 3, 1, noop); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	failure := errors.New("handler failed")
	if applied, err := s.ApplyFreshBatch(ctx, b, "batch", input, "filtered", 3, 10, func(context.Context, pgx.Tx, telemetry.Event) error { return failure }); applied || !errors.Is(err, failure) {
		t.Fatal(applied, err)
	}
	counts(t, s, b, 2, 2, 0)
	var work int
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM stream_consumer_work WHERE tenant_id=$1`, b.TenantID).Scan(&work); err != nil || work != 0 {
		t.Fatal(work, err)
	}
	if applied, err := s.ApplyFreshBatch(ctx, b, "batch", input, "filtered", 3, 10, noop); !applied || err != nil {
		t.Fatal(applied, err)
	}
	counts(t, s, b, 2, 2, 2)
	if applied, err := s.ApplyFreshBatch(ctx, b, "batch", input, "filtered", 3, 10, func(context.Context, pgx.Tx, telemetry.Event) error { t.Fatal("replayed effect"); return nil }); applied || err != nil {
		t.Fatal(applied, err)
	}
	if err := s.Pool.QueryRow(ctx, `SELECT retained_records FROM stream_metadata_budgets WHERE tenant_id=$1 AND processor='batch'`, b.TenantID).Scan(&work); err != nil || work != 2 {
		t.Fatal(work, err)
	}
}
