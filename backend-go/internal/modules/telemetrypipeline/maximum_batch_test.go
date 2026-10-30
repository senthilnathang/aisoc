package telemetrypipeline

import (
	"context"
	"fmt"
	"testing"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"github.com/jackc/pgx/v5"
)

func TestMaximumBatchDurableDeliveryAndReplay(t *testing.T) {
	r, _, template := setup(t)
	ctx := context.Background()
	noop := func(context.Context, pgx.Tx, telemetry.Event) error { return nil }
	publish(t, r)
	if err := r.Poll(ctx, "filtered", noop); err != nil {
		t.Fatal(err)
	}
	r.Store.MaxEvents = telemetry.MaxBatchEvents + 1
	r.MaxEntries = telemetry.MaxBatchEvents + 1
	r.MaxRecoveryRecords = telemetry.MaxBatchEvents + 1
	events := make([]telemetry.Event, telemetry.MaxBatchEvents)
	for i := range events {
		events[i] = template
		events[i].SourceEventID = fmt.Sprintf("maximum-%d", i)
	}
	cp, err := r.Store.Checkpoint(ctx, r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.Store.Accept(ctx, r.Binding, cp, "maximum", events); err != nil {
		t.Fatal(err)
	}
	if n, err := r.PublishBatch(ctx, telemetry.MaxBatchEvents); err != nil || n != len(events) {
		t.Fatal(n, err)
	}
	deliveries, err := r.Consumer.Read(ctx, r.Binding, r.Processor, r.ConsumerName, telemetry.MaxBatchEvents, time.Millisecond)
	if err != nil || len(deliveries) != len(events) {
		t.Fatal(len(deliveries), err)
	}
	keys, ids := []string{}, []string{}
	for _, delivery := range deliveries {
		keys = append(keys, delivery.Key)
		ids = append(ids, delivery.ID)
	}
	var mapped int
	if err = r.Store.Pool.QueryRow(ctx, `SELECT count(*) FROM stream_outbox o JOIN unnest($4::text[],$5::text[]) AS d(k,id) ON o.event_key=d.k AND o.message_id=d.id WHERE o.tenant_id=$1 AND o.connector_id=$2 AND o.source=$3`, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, keys, ids).Scan(&mapped); err != nil || mapped != len(events) {
		t.Fatal("incorrect publication mapping", mapped, err)
	}
	applied := 0
	apply := func(context.Context, pgx.Tx, telemetry.Event) error { applied++; return nil }
	if err = r.ProcessBatch(ctx, deliveries, "filtered", apply); err != nil {
		t.Fatal(err)
	}
	if applied != len(events) {
		t.Fatal("missing effects", applied)
	}
	if err = r.ProcessBatch(ctx, deliveries, "filtered", func(context.Context, pgx.Tx, telemetry.Event) error { t.Fatal("duplicate effect"); return nil }); err != nil {
		t.Fatal(err)
	}
	snapshot, err := r.Store.Snapshot(ctx, r.Binding, r.Processor)
	if err != nil || snapshot.Completed != telemetry.MaxBatchEvents+1 || snapshot.Pending != 0 {
		t.Fatal(snapshot, err)
	}
	if pending, err := r.Consumer.Pending(ctx, r.Binding, r.Processor); err != nil || pending != 0 {
		t.Fatal(pending, err)
	}
}
