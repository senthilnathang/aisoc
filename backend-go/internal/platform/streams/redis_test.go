package streams

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func setup(t *testing.T) (*Client, *Client, *Client, telemetry.Binding, telemetry.Event) {
	t.Helper()
	address := os.Getenv("AISOC_TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("disposable Redis URL required; run check_streams.py")
	}
	clients := make([]*Client, 0, 3)
	for _, role := range []string{"publisher", "consumer", "admin"} {
		c, err := New(Config{address, "aisoc-" + role, os.Getenv("AISOC_TEST_REDIS_" + strings.ToUpper(role) + "_PASSWORD")})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = c.Close() })
		if err := c.Health(context.Background()); err != nil {
			t.Fatal(role, err)
		}
		clients = append(clients, c)
	}
	b := telemetry.Binding{TenantID: "stream-" + jobs.ID(), ConnectorID: "mock-qradar", Source: "qradar-siem"}
	key, _ := Key(b)
	t.Cleanup(func() {
		if err := clients[2].redis.Del(context.Background(), key).Err(); err != nil {
			t.Error(err)
		}
	})
	e := telemetry.Event{SchemaVersion: "1.0", EventID: "mock-delivery", TenantID: b.TenantID, ConnectorID: b.ConnectorID, Source: b.Source, SourceEventID: "mock-auth-1", SourceRevision: "1", EventType: "authentication.failed", EventTime: "2026-10-29T10:00:00Z", IngestedAt: "2026-10-29T10:00:01Z", Severity: "medium", EvidenceRef: "mock:auth-1", TraceID: "trace-1", Projection: telemetry.Projection{PrincipalRef: "mock-user", AssetRef: "mock-device", SourceIP: "192.0.2.10"}}
	return clients[0], clients[1], clients[2], b, e
}

func TestValidationDoesNotNeedRedis(t *testing.T) {
	for _, address := range []string{"0.0.0.0:6379", "example.com:6379", "127.0.0.1:0"} {
		if c, err := New(Config{address, "publisher", strings.Repeat("x", 32)}); err == nil {
			c.Close()
			t.Fatal("unsafe address accepted")
		}
	}
	c, err := New(Config{"127.0.0.1:16379", "publisher", strings.Repeat("x", 32)})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	b := telemetry.Binding{TenantID: "tenant", ConnectorID: "connector", Source: "source"}
	ctx := context.Background()
	if _, err := c.Read(ctx, b, "group", "consumer", 101, time.Second); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err := c.Read(ctx, b, "group", "consumer", 1, 0); !errors.Is(err, ErrInvalid) {
		t.Fatal("unbounded block accepted", err)
	}
	if _, err := c.Ack(ctx, b, "group"); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err := c.Reclaim(ctx, b, "group", "consumer", "0-0", 1, 0); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err := Key(telemetry.Binding{TenantID: "*"}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	other := b
	other.TenantID = "other"
	a, _ := Key(b)
	z, _ := Key(other)
	if a == z {
		t.Fatal("tenant key collision")
	}
}

func TestACLsPublishReadAndExplicitAck(t *testing.T) {
	p, c, a, b, e := setup(t)
	ctx := context.Background()
	anonymous := redis.NewClient(&redis.Options{Addr: os.Getenv("AISOC_TEST_REDIS_ADDR"), Protocol: 2, MaxRetries: -1, DialTimeout: time.Second})
	defer anonymous.Close()
	if anonymous.Ping(ctx).Err() == nil {
		t.Fatal("default unauthenticated user enabled")
	}
	if err := p.EnsureGroup(ctx, b, "workers"); err == nil {
		t.Fatal("publisher created consumer group")
	}
	if _, err := c.Publish(ctx, b, e); err == nil {
		t.Fatal("consumer published")
	}
	if err := a.redis.Set(ctx, "unrelated-service-key", "x", 0).Err(); err == nil {
		t.Fatal("admin escaped AISOC keys")
	}
	bad, err := New(Config{os.Getenv("AISOC_TEST_REDIS_ADDR"), "aisoc-publisher", strings.Repeat("wrong", 8)})
	if err != nil {
		t.Fatal(err)
	}
	defer bad.Close()
	if bad.Health(ctx) == nil {
		t.Fatal("invalid credential accepted")
	}
	first, err := p.Publish(ctx, b, e)
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.Publish(ctx, b, e)
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("delivery IDs reused")
	}
	if err := c.EnsureGroup(ctx, b, "workers"); err != nil {
		t.Fatal(err)
	}
	if err := c.EnsureGroup(ctx, b, "workers"); err != nil {
		t.Fatal("repeat group setup", err)
	}
	messages, err := c.Read(ctx, b, "workers", "consumer-a", 10, time.Millisecond)
	if err != nil || len(messages) != 2 {
		t.Fatal(messages, err)
	}
	for _, d := range messages {
		if d.Err != nil || d.Key != e.Identity() {
			t.Fatal(d)
		}
	}
	if n, err := c.Pending(ctx, b, "workers"); err != nil || n != 2 {
		t.Fatal("implicit ACK", n, err)
	}
	if n, err := c.Ack(ctx, b, "workers", first, second); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	if n, err := c.Ack(ctx, b, "workers", first); err != nil || n != 0 {
		t.Fatal("repeat ACK", n, err)
	}
	key, _ := Key(b)
	if n, err := a.redis.XLen(ctx, key).Result(); err != nil || n != 2 {
		t.Fatal("ACK deleted recovery payload", n, err)
	}
	foreign := b
	foreign.TenantID = "foreign"
	if _, err := p.Publish(ctx, foreign, e); !errors.Is(err, telemetry.ErrBinding) {
		t.Fatal("foreign publication", err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := c.Read(cancelled, b, "workers", "consumer-a", 1, time.Second); err == nil {
		t.Fatal("cancelled read accepted")
	}
}

func TestConcurrentConsumersShareGroup(t *testing.T) {
	p, c, _, b, e := setup(t)
	ctx := context.Background()
	if err := c.EnsureGroup(ctx, b, "workers"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		e.SourceEventID = jobs.ID()
		if _, err := p.Publish(ctx, b, e); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	results := make(chan []Delivery, 2)
	errs := make(chan error, 2)
	for _, name := range []string{"consumer-a", "consumer-b"} {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			messages, err := c.Read(ctx, b, "workers", name, 5, time.Second)
			results <- messages
			if err != nil {
				errs <- err
			}
		}(name)
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for batch := range results {
		if len(batch) != 5 {
			t.Fatalf("consumer batch size=%d", len(batch))
		}
		for _, d := range batch {
			if d.Err != nil || seen[d.ID] {
				t.Fatal("duplicate/invalid delivery", d)
			}
			seen[d.ID] = true
		}
	}
	if len(seen) != 10 {
		t.Fatal("lost deliveries")
	}
	if n, err := c.Pending(ctx, b, "workers"); err != nil || n != 10 {
		t.Fatal("read implicitly ACKed", n, err)
	}
}

func TestConcurrentBoundedPublishDoesNotOvershoot(t *testing.T) {
	p, _, a, b, e := setup(t)
	ctx := context.Background()
	key, _ := Key(b)
	var wg sync.WaitGroup
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := p.PublishBounded(ctx, b, e, 2); results <- err }()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if !errors.Is(err, ErrBackpressure) {
			t.Fatal(err)
		}
	}
	if accepted != 2 {
		t.Fatalf("accepted=%d", accepted)
	}
	if n, err := a.redis.XLen(ctx, key).Result(); err != nil || n != 2 {
		t.Fatal("capacity overshoot", n, err)
	}
}

func TestReclaimReportsMissingPayloadsAndKeepsPoisonPending(t *testing.T) {
	p, c, a, b, e := setup(t)
	ctx := context.Background()
	key, _ := Key(b)
	valid, err := p.Publish(ctx, b, e)
	if err != nil {
		t.Fatal(err)
	}
	deleted, err := p.Publish(ctx, b, e)
	if err != nil {
		t.Fatal(err)
	}
	poison, err := a.redis.XAdd(ctx, &redis.XAddArgs{Stream: key, Values: map[string]any{"envelope": "bad-json"}}).Result()
	if err != nil {
		t.Fatal(err)
	}
	if err := c.EnsureGroup(ctx, b, "workers"); err != nil {
		t.Fatal(err)
	}
	read, err := c.Read(ctx, b, "workers", "old", 10, time.Millisecond)
	if err != nil || len(read) != 3 {
		t.Fatal(err)
	}
	if read[2].ID != poison || read[2].Err == nil {
		t.Fatal("poison not exposed", read)
	}
	if err := a.redis.Do(ctx, "XCLAIM", key, "workers", "old", 0, valid, deleted, poison, "IDLE", 2000, "JUSTID").Err(); err != nil {
		t.Fatal(err)
	}
	if err := a.redis.XDel(ctx, key, deleted).Err(); err != nil {
		t.Fatal(err)
	}
	page, err := c.Reclaim(ctx, b, "workers", "replacement", "0-0", 10, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if page.Next != "0-0" || len(page.DeletedIDs) != 1 || page.DeletedIDs[0] != deleted || len(page.Deliveries) != 2 {
		t.Fatalf("bad reclaim page: %+v", page)
	}
	if page.Deliveries[0].Key != e.Identity() || page.Deliveries[0].Err != nil || page.Deliveries[1].Err == nil {
		t.Fatal(page)
	}
	if n, err := c.Pending(ctx, b, "workers"); err != nil || n != 2 {
		t.Fatal("reclaim silently ACKed", n, err)
	}
}

func TestOutboxToStreamToInboxReplay(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("run full framework with --with-streams for PostgreSQL/Redis bridge")
	}
	p, c, a, b, e := setup(t)
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, table := range []string{"stream_inbox", "stream_outbox", "stream_events", "stream_source_checkpoints", "jobs"} {
			if _, err := pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", b.TenantID); err != nil {
				t.Error(err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, b.TenantID); err != nil {
			t.Error(err)
		}
	}()
	store := eventstate.Store{Pool: pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}
	if _, err := store.Accept(ctx, b, eventstate.Checkpoint{}, "page-1", []telemetry.Event{e}); err != nil {
		t.Fatal(err)
	}
	lease, err := store.Claim(ctx, b)
	if err != nil || lease == nil {
		t.Fatal(err)
	}
	payload, err := telemetry.Decode(lease.Envelope, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Publish(ctx, b, payload); err != nil {
		t.Fatal(err)
	}
	// Simulate the publisher losing its Redis acknowledgment before DB recording.
	if _, err := pool.Exec(ctx, `UPDATE stream_outbox SET lease_until=now()-interval '1 second' WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	lease, err = store.Claim(ctx, b)
	if err != nil || lease == nil {
		t.Fatal(err)
	}
	messageID, err := p.Publish(ctx, b, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.MarkPublished(ctx, b, *lease, messageID); err != nil {
		t.Fatal(err)
	}
	if err := c.EnsureGroup(ctx, b, "bridge-v1"); err != nil {
		t.Fatal(err)
	}
	deliveries, err := c.Read(ctx, b, "bridge-v1", "old", 10, time.Millisecond)
	if err != nil || len(deliveries) != 2 {
		t.Fatal(deliveries, err)
	}
	effect := func(ctx context.Context, tx pgx.Tx, event telemetry.Event) error {
		return jobs.Enqueue(ctx, tx, event.TenantID, jobs.ID(), "python.normalize", []byte("sandbox"))
	}
	first := deliveries[0]
	if first.Err != nil {
		t.Fatal(first.Err)
	}
	if applied, err := store.Apply(ctx, b, "bridge-v1", first.Key, first.ContentHash, "finding", effect); err != nil || !applied {
		t.Fatal(applied, err)
	}
	// Simulate consumer loss after DB commit but before ACK, then reclaim both deliveries.
	key, _ := Key(b)
	if err := a.redis.Do(ctx, "XCLAIM", key, "bridge-v1", "old", 0, deliveries[0].ID, deliveries[1].ID, "IDLE", 2000, "JUSTID").Err(); err != nil {
		t.Fatal(err)
	}
	page, err := c.Reclaim(ctx, b, "bridge-v1", "new", "0-0", 10, time.Second)
	if err != nil || len(page.Deliveries) != 2 {
		t.Fatal(page, err)
	}
	for _, d := range page.Deliveries {
		if d.Err != nil {
			t.Fatal(d.Err)
		}
		if applied, err := store.Apply(ctx, b, "bridge-v1", d.Key, d.ContentHash, "finding", effect); err != nil || applied {
			t.Fatal("duplicate effect", applied, err)
		}
		if _, err := c.Ack(ctx, b, "bridge-v1", d.ID); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE tenant_id=$1`, b.TenantID).Scan(&count); err != nil || count != 1 {
		t.Fatal("duplicate jobs", count, err)
	}
	if n, err := c.Pending(ctx, b, "bridge-v1"); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}
