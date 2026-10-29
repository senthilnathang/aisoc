package telemetrypipeline

import (
	"context"
	"fmt"
	"testing"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/streams"
	"github.com/jackc/pgx/v5"
)

func TestBacklogTransportLossAndSourceContinuation(t *testing.T) {
	r, admin, template := setup(t)
	ctx := context.Background()
	r.Store.MaxEvents = 501
	r.Store.MaxPayloadBytes = 2 << 20
	r.MaxEntries = 1000
	r.MaxRecoveryRecords = 1100
	cp, err := r.Store.Checkpoint(ctx, r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	for page := 0; page < 4; page++ {
		events := make([]telemetry.Event, 100)
		for i := range events {
			events[i] = template
			events[i].SourceEventID = fmt.Sprintf("backlog-%d", page*100+i)
		}
		accepted, err := r.Store.Accept(ctx, r.Binding, cp, fmt.Sprintf("page-%d", page), events)
		if err != nil {
			t.Fatal(err)
		}
		cp = accepted.Checkpoint
	}
	publishAll := func() {
		t.Helper()
		for {
			n, err := r.PublishBatch(ctx, 25)
			if err != nil {
				t.Fatal(err)
			}
			if n == 0 {
				return
			}
		}
	}
	seen := map[string]int{}
	effect := func(_ context.Context, _ pgx.Tx, e telemetry.Event) error { seen[e.Identity()]++; return nil }
	publishAll()
	for i := 0; i < 5; i++ {
		if err = r.Poll(ctx, "filtered", effect); err != nil {
			t.Fatal(err)
		}
	}
	key, _ := streams.Key(r.Binding)
	if err = admin.Del(ctx, key).Err(); err != nil {
		t.Fatal(err)
	}
	// Acceptance stays durable while the entire transport/group has disappeared.
	events := make([]telemetry.Event, 100)
	for i := range events {
		events[i] = template
		events[i].SourceEventID = fmt.Sprintf("after-loss-%d", i)
	}
	if _, err = r.Store.Accept(ctx, r.Binding, cp, "after-loss", events); err != nil {
		t.Fatal(err)
	}
	if err = r.Consumer.EnsureGroup(ctx, r.Binding, r.Processor); err != nil {
		t.Fatal(err)
	}
	after := ""
	for {
		after, err = r.Reconcile(ctx, after)
		if err != nil {
			t.Fatal(err)
		}
		if after == "" {
			break
		}
	}
	publishAll()
	for pass := 0; pass < 60 && len(seen) < 501; pass++ {
		if err = r.Poll(ctx, "filtered", effect); err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 501 {
		t.Fatal("unrecovered events", len(seen))
	}
	for _, n := range seen {
		if n != 1 {
			t.Fatal("duplicate callback", n)
		}
	}
	snapshot, err := r.Store.Snapshot(ctx, r.Binding, r.Processor)
	if err != nil || snapshot.Completed != 501 || snapshot.Pending != 0 || snapshot.Dead != 0 || snapshot.HistoricalGaps != 351 {
		t.Fatal(snapshot, err)
	}
	if pending, err := r.Consumer.Pending(ctx, r.Binding, r.Processor); err != nil || pending != 0 {
		t.Fatal(pending, err)
	}
}
