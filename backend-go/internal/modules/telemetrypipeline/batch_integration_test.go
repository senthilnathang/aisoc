package telemetrypipeline

import (
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/streams"
	"context"
	"errors"
	"testing"
)

func TestBatchBackpressureReleasesUnattemptedLeases(t *testing.T) {
	r, _, e := setup(t)
	ctx := context.Background()
	second := e
	second.SourceEventID = "second"
	third := e
	third.SourceEventID = "third"
	cp, err := r.Store.Checkpoint(ctx, r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.Store.Accept(ctx, r.Binding, cp, "batch", []telemetry.Event{second, third}); err != nil {
		t.Fatal(err)
	}
	r.MaxEntries = 1
	n, err := r.PublishBatch(ctx, 3)
	if n != 1 || !errors.Is(err, streams.ErrBackpressure) {
		t.Fatal(n, err)
	}
	var queued, published int
	if err = r.Store.Pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE state='queued' AND attempts=0 AND lease_until IS NULL),count(*) FILTER(WHERE state='published') FROM stream_outbox WHERE tenant_id=$1`, r.Binding.TenantID).Scan(&queued, &published); err != nil || queued != 2 || published != 1 {
		t.Fatal(queued, published, err)
	}
}
