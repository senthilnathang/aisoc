package telemetrypipeline

import (
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/streams"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"os"
	"testing"
	"time"
)

func TestSnapshotAndConservativeRetention(t *testing.T) {
	r, a, e := setup(t)
	ctx := context.Background()
	before, err := r.Store.Snapshot(ctx, r.Binding, r.Processor)
	if err != nil || before.Accepted != 1 || before.Pending != 1 {
		t.Fatal(before, err)
	}
	key, _ := streams.Key(r.Binding)
	raw, _ := json.Marshal(e)
	id, err := a.XAdd(ctx, &redis.XAddArgs{Stream: key, ID: "1000000000000-0", Values: map[string]any{"schema_version": "1.0", "event_key": e.Identity(), "content_hash": e.ContentHash(), "envelope": string(raw)}}).Result()
	if err != nil {
		t.Fatal(err)
	}
	lease, err := r.Store.Claim(ctx, r.Binding)
	if err != nil || lease == nil {
		t.Fatal(err)
	}
	if err = r.Store.MarkPublished(ctx, r.Binding, *lease, id); err != nil {
		t.Fatal(err)
	}
	retire, err := streams.New(streams.Config{Address: os.Getenv("AISOC_TEST_REDIS_ADDR"), Username: "aisoc-retention", Password: os.Getenv("AISOC_TEST_REDIS_RETENTION_PASSWORD")})
	if err != nil {
		t.Fatal(err)
	}
	defer retire.Close()
	prune := func() RetentionPage {
		t.Helper()
		p, err := r.Prune(ctx, retire, "", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	if p := prune(); p.Removed != 0 || p.Skipped["uncommitted"] != 1 {
		t.Fatal(p)
	}
	deliveries, err := r.Consumer.Read(ctx, r.Binding, r.Processor, r.ConsumerName, 1, time.Millisecond)
	if err != nil || len(deliveries) != 1 {
		t.Fatal(deliveries, err)
	}
	if _, err = r.Store.Apply(ctx, r.Binding, r.Processor, e.Identity(), e.ContentHash(), "filtered", func(context.Context, pgx.Tx, telemetry.Event) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if p := prune(); p.Removed != 0 || p.Skipped["pending"] != 1 {
		t.Fatal(p)
	}
	if _, err = r.Consumer.Ack(ctx, r.Binding, r.Processor, id); err != nil {
		t.Fatal(err)
	}
	if err = a.XGroupCreate(ctx, key, "other-group", "0").Err(); err != nil {
		t.Fatal(err)
	}
	if p := prune(); p.Removed != 0 || p.Skipped["group_mismatch"] != 1 {
		t.Fatal(p)
	}
	if err = a.XGroupDestroy(ctx, key, "other-group").Err(); err != nil {
		t.Fatal(err)
	}
	if p := prune(); p.Removed != 1 {
		t.Fatal(p)
	}
	if p := prune(); p.Removed != 0 {
		t.Fatal("non-idempotent cleanup", p)
	}
	after, err := r.Store.Snapshot(ctx, r.Binding, r.Processor)
	if err != nil || after.Accepted != 1 || after.Completed != 1 || after.Pending != 0 || after.Accepted != after.Completed+after.Dead+after.Pending {
		t.Fatal(after, err)
	}
	// Recent duplicate delivery stays retained even with a committed inbox.
	if _, err = r.Publisher.Publish(ctx, r.Binding, e); err != nil {
		t.Fatal(err)
	}
	if p := prune(); p.Removed != 0 || p.Skipped["young"] != 1 {
		t.Fatal(p)
	}
	if _, err = r.Consumer.Retire(ctx, r.Binding, r.Processor, deliveries[0], time.Minute); err == nil {
		t.Fatal("consumer received deletion permission")
	}
}
