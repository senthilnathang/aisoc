package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5"
	"testing"
	"time"
)

func TestFreshConsumerDoesNotWaitForCheckpointCursorWriter(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	second := e
	second.SourceEventID = "lock-second"
	accept(t, s, b, Checkpoint{}, "page", e, second)
	t.Cleanup(func() { s.Pool.Exec(ctx, `DELETE FROM stream_consumer_work WHERE tenant_id=$1`, b.TenantID) })
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT 1 FROM stream_source_checkpoints WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 FOR NO KEY UPDATE`, b.TenantID, b.ConnectorID, b.Source); err != nil {
		t.Fatal(err)
	}
	bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	ok, err := s.ApplyFreshBatch(bounded, b, "independent", []BatchEvent{{e.Identity(), e.ContentHash()}, {second.Identity(), second.ContentHash()}}, "filtered", 3, 10, func(context.Context, pgx.Tx, telemetry.Event) error { return nil })
	if err != nil || !ok {
		t.Fatalf("consumer blocked by unrelated cursor writer: %v %v", ok, err)
	}
}
