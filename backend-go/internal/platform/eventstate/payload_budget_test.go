package eventstate

import (
	"context"
	"testing"
)

func TestPayloadCounterMatchesRowsAndRollsBack(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page", e)
	var hot, total, size, actual int64
	if err := s.Pool.QueryRow(ctx, `SELECT hot_events,total_events,hot_bytes,(SELECT sum(octet_length(envelope)) FROM stream_events WHERE tenant_id=$1) FROM stream_payload_budgets WHERE tenant_id=$1`, b.TenantID).Scan(&hot, &total, &size, &actual); err != nil || hot != 1 || total != 1 || size != actual {
		t.Fatal(hot, total, size, actual, err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE stream_events SET envelope=envelope||convert_to(' ','UTF8') WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	var changed int64
	if err = tx.QueryRow(ctx, `SELECT hot_bytes FROM stream_payload_budgets WHERE tenant_id=$1`, b.TenantID).Scan(&changed); err != nil || changed != size+1 {
		t.Fatal(changed, err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT hot_bytes FROM stream_payload_budgets WHERE tenant_id=$1`, b.TenantID).Scan(&changed); err != nil || changed != size {
		t.Fatal("counter did not roll back", changed, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE stream_events SET connector_id='other' WHERE tenant_id=$1`, b.TenantID); err == nil {
		t.Fatal("mutable event identity")
	}
}
