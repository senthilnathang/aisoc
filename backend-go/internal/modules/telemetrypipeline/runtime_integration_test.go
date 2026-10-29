package telemetrypipeline

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/streams"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func setup(t *testing.T) (Runtime, *redis.Client, telemetry.Event) {
	t.Helper()
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	addr := os.Getenv("AISOC_TEST_REDIS_ADDR")
	if url == "" || addr == "" {
		t.Skip("run check.py --with-streams for disposable PostgreSQL/Redis")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	b := telemetry.Binding{TenantID: "recovery-" + jobs.ID(), ConnectorID: "mock-qradar", Source: "qradar-siem"}
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	newClient := func(role string) *streams.Client {
		c, err := streams.New(streams.Config{Address: addr, Username: "aisoc-" + role, Password: os.Getenv("AISOC_TEST_REDIS_" + strings.ToUpper(role) + "_PASSWORD")})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		return c
	}
	a := redis.NewClient(&redis.Options{Addr: addr, Username: "aisoc-admin", Password: os.Getenv("AISOC_TEST_REDIS_ADMIN_PASSWORD"), Protocol: 2, DisableIdentity: true, MaxRetries: -1})
	t.Cleanup(func() { a.Close() })
	r := Runtime{Store: eventstate.Store{Pool: pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}, Publisher: newClient("publisher"), Consumer: newClient("consumer"), Binding: b, Processor: "recovery-v1", ConsumerName: "worker-a", MaxEntries: 100, MaxRecoveryRecords: 100, MaxAttempts: 2}
	key, _ := streams.Key(b)
	t.Cleanup(func() {
		if err := a.Del(ctx, key).Err(); err != nil {
			t.Error(err)
		}
		for _, table := range []string{"stream_dead_letters", "stream_consumer_work", "stream_replay_gaps", "stream_inbox", "stream_outbox", "stream_events", "stream_source_checkpoints", "jobs"} {
			// Bound test teardown too: large retained fixtures must not require
			// weakening the application's statement timeout for a bulk delete.
			for {
				result, err := pool.Exec(ctx, "DELETE FROM "+table+" WHERE ctid IN (SELECT ctid FROM "+table+" WHERE tenant_id=$1 LIMIT 100)", b.TenantID)
				if err != nil {
					t.Error(err)
					break
				}
				if result.RowsAffected() == 0 {
					break
				}
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, b.TenantID); err != nil {
			t.Error(err)
		}
	})
	e := telemetry.Event{SchemaVersion: "1.0", EventID: "delivery-1", TenantID: b.TenantID, ConnectorID: b.ConnectorID, Source: b.Source, SourceEventID: "auth-1", SourceRevision: "1", EventType: "authentication.failed", EventTime: "2026-10-29T10:00:00Z", IngestedAt: "2026-10-29T10:00:01Z", Severity: "medium", EvidenceRef: "mock:auth-1", TraceID: "trace-1", Projection: telemetry.Projection{PrincipalRef: "mock-user", AssetRef: "mock-asset", SourceIP: "192.0.2.10"}}
	if _, err := r.Store.Accept(ctx, b, eventstate.Checkpoint{}, "page-1", []telemetry.Event{e}); err != nil {
		t.Fatal(err)
	}
	if err := r.Consumer.EnsureGroup(ctx, b, r.Processor); err != nil {
		t.Fatal(err)
	}
	return r, a, e
}

func effect(ctx context.Context, tx pgx.Tx, e telemetry.Event) error {
	return jobs.Enqueue(ctx, tx, e.TenantID, jobs.ID(), "python.normalize", []byte("sandbox"))
}
func publish(t *testing.T, r Runtime) {
	t.Helper()
	ok, err := r.PublishOne(context.Background())
	if err != nil || !ok {
		t.Fatal("publish", ok, err)
	}
}
func read(t *testing.T, r Runtime) streams.Delivery {
	t.Helper()
	d, err := r.Consumer.Read(context.Background(), r.Binding, r.Processor, r.ConsumerName, 1, time.Millisecond)
	if err != nil || len(d) != 1 {
		t.Fatal("read", d, err)
	}
	return d[0]
}
func count(t *testing.T, r Runtime, table string, want int) {
	t.Helper()
	var n int
	err := r.Store.Pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", r.Binding.TenantID).Scan(&n)
	if err != nil || n != want {
		t.Fatalf("%s got %d want %d: %v", table, n, want, err)
	}
}
func expireWork(t *testing.T, r Runtime) {
	t.Helper()
	_, err := r.Store.Pool.Exec(context.Background(), `UPDATE stream_consumer_work SET available_at=now()-interval '1 minute',lease_until=CASE WHEN state='running' THEN now()-interval '1 minute' ELSE NULL END WHERE tenant_id=$1`, r.Binding.TenantID)
	if err != nil {
		t.Fatal(err)
	}
}

func TestDurableRetryBudgetAndAtomicEffects(t *testing.T) {
	r, _, _ := setup(t)
	ctx := context.Background()
	publish(t, r)
	d := read(t, r)
	fail := func(ctx context.Context, tx pgx.Tx, e telemetry.Event) error {
		if err := effect(ctx, tx, e); err != nil {
			return err
		}
		return errors.New("fixture handler failure")
	}
	if r.Process(ctx, d, "finding", fail) == nil {
		t.Fatal("failure hidden")
	}
	count(t, r, "jobs", 0)
	count(t, r, "stream_inbox", 0)
	stats, err := r.Store.RecoveryStats(ctx, r.Binding, r.Processor)
	if err != nil || stats.Waiting != 1 {
		t.Fatal(stats, err)
	}
	if err := r.Process(ctx, d, "finding", fail); err != nil {
		t.Fatal("early retry should wait", err)
	}
	expireWork(t, r)
	if r.Process(ctx, d, "finding", fail) == nil {
		t.Fatal("exhaustion hidden")
	}
	count(t, r, "stream_dead_letters", 1)
	count(t, r, "jobs", 0)
	if n, err := r.Consumer.Pending(ctx, r.Binding, r.Processor); err != nil || n != 0 {
		t.Fatal("DLQ not acknowledged", n, err)
	}
	if err := r.Process(ctx, d, "finding", effect); err != nil {
		t.Fatal(err)
	}
	count(t, r, "jobs", 0)
}

func TestDLQFailureDoesNotAckAndPoisonCannotBlockGoodEvent(t *testing.T) {
	r, a, e := setup(t)
	ctx := context.Background()
	key, _ := streams.Key(r.Binding)
	if err := a.XAdd(ctx, &redis.XAddArgs{Stream: key, Values: map[string]any{"raw": "untrusted"}}).Err(); err != nil {
		t.Fatal(err)
	}
	d := read(t, r)
	if d.Err == nil {
		t.Fatal("expected poison")
	}
	_, err := r.Store.Pool.Exec(ctx, `CREATE FUNCTION stream_test_dlq_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture DLQ storage outage'; END $$; CREATE TRIGGER stream_test_dlq_failure BEFORE INSERT ON stream_dead_letters FOR EACH ROW EXECUTE FUNCTION stream_test_dlq_failure();`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Store.Pool.Exec(ctx, `DROP FUNCTION IF EXISTS stream_test_dlq_failure() CASCADE`) })
	if r.Process(ctx, d, "finding", effect) == nil {
		t.Fatal("DLQ outage hidden")
	}
	if n, err := r.Consumer.Pending(ctx, r.Binding, r.Processor); err != nil || n != 1 {
		t.Fatal("ACKed without DLQ", n, err)
	}
	count(t, r, "stream_dead_letters", 0)
	if _, err := r.Store.Pool.Exec(ctx, `DROP FUNCTION stream_test_dlq_failure() CASCADE`); err != nil {
		t.Fatal(err)
	}
	expireWork(t, r)
	if err := r.Process(ctx, d, "finding", effect); err != nil {
		t.Fatal(err)
	}
	count(t, r, "stream_dead_letters", 1)
	// A well-formed but conflicting delivery also belongs to its delivery ID,
	// never to the legitimate accepted event's retry budget.
	forged := e
	forged.Projection.AssetRef = "forged"
	if _, err := r.Publisher.Publish(ctx, r.Binding, forged); err != nil {
		t.Fatal(err)
	}
	bad := read(t, r)
	if err := r.Process(ctx, bad, "finding", effect); err != nil {
		t.Fatal(err)
	}
	publish(t, r)
	if err := r.Process(ctx, read(t, r), "finding", effect); err != nil {
		t.Fatal(err)
	}
	count(t, r, "jobs", 1)
	count(t, r, "stream_dead_letters", 2)
}

func TestRedisStreamLossReplaysDurableEvents(t *testing.T) {
	r, a, _ := setup(t)
	ctx := context.Background()
	publish(t, r)
	key, _ := streams.Key(r.Binding)
	// Delete the entire disposable source stream, including the group/PEL.
	if err := a.Del(ctx, key).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(ctx, ""); err != nil {
		t.Fatal(err)
	}
	count(t, r, "stream_replay_gaps", 1)
	publish(t, r)
	if err := r.Poll(ctx, "finding", effect); err != nil {
		t.Fatal(err)
	}
	count(t, r, "jobs", 1)
	if _, err := r.Reconcile(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.PublishOne(ctx); err != nil || ok {
		t.Fatal("replayed completed work", ok, err)
	}
}

func TestTrimmedPendingEntryAndReclaimedCrash(t *testing.T) {
	r, a, _ := setup(t)
	ctx := context.Background()
	publish(t, r)
	d := read(t, r)
	key, _ := streams.Key(r.Binding)
	if err := a.XDel(ctx, key, d.ID).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Recover(ctx, "0-0", "finding", effect); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(ctx, ""); err != nil {
		t.Fatal(err)
	}
	publish(t, r)
	d = read(t, r)
	// Claim and crash without starting effects; durable work will be reclaimed.
	old, err := r.Store.BeginWork(ctx, r.Binding, r.Processor, "event:"+d.Key, d.ID, 2, 100)
	if err != nil {
		t.Fatal(err)
	}
	expireWork(t, r)
	if err := a.Do(ctx, "XCLAIM", key, r.Processor, "crashed", 0, d.ID, "IDLE", 40000, "JUSTID").Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Recover(ctx, "0-0", "finding", effect); err != nil {
		t.Fatal(err)
	}
	count(t, r, "jobs", 1)
	if err := r.Store.FinishReplay(ctx, r.Binding, r.Processor, old); !errors.Is(err, eventstate.ErrLease) {
		t.Fatal("stale attempt accepted", err)
	}
	count(t, r, "stream_replay_gaps", 1)
}

func TestBackpressureAndMemoryExhaustionRetainOutbox(t *testing.T) {
	r, a, e := setup(t)
	ctx := context.Background()
	r.MaxEntries = 1
	publish(t, r)
	cp, err := r.Store.Checkpoint(ctx, r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	e.SourceEventID = "auth-2"
	if _, err := r.Store.Accept(ctx, r.Binding, cp, "page-2", []telemetry.Event{e}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.PublishOne(ctx); !errors.Is(err, streams.ErrBackpressure) {
		t.Fatal("capacity not enforced", err)
	}
	var attempts int
	var state string
	if err := r.Store.Pool.QueryRow(ctx, `SELECT attempts,state FROM stream_outbox WHERE tenant_id=$1 AND event_key=$2`, r.Binding.TenantID, e.Identity()).Scan(&attempts, &state); err != nil || attempts != 0 || state != "queued" {
		t.Fatal(attempts, state, err)
	}
	r.MaxEntries = 100
	if _, err := r.Store.Pool.Exec(ctx, `UPDATE stream_outbox SET available_at=now() WHERE tenant_id=$1`, r.Binding.TenantID); err != nil {
		t.Fatal(err)
	}
	if err := a.ConfigSet(ctx, "maxmemory", "1").Err(); err != nil {
		t.Fatal(err)
	}
	defer a.ConfigSet(ctx, "maxmemory", "64mb")
	if _, err := r.PublishOne(ctx); !errors.Is(err, streams.ErrBackpressure) {
		t.Fatal("OOM not backpressure", err)
	}
	count(t, r, "stream_events", 2)
	if err := a.ConfigSet(ctx, "maxmemory", "64mb").Err(); err != nil {
		t.Fatal(err)
	}
}

func TestTransportOutageRetriesWithoutAdvancingPublication(t *testing.T) {
	r, _, _ := setup(t)
	ctx := context.Background()
	original := r.Publisher
	// Blackhole a local TCP connection: no Redis handshake or command response.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			<-finished
		}
	}()
	blocked, err := streams.New(streams.Config{Address: listener.Addr().String(), Username: "aisoc-publisher", Password: strings.Repeat("x", 32)})
	if err != nil {
		t.Fatal(err)
	}
	defer blocked.Close()
	r.Publisher = blocked
	start := time.Now()
	if _, err := r.PublishOne(ctx); err == nil {
		t.Fatal("outage accepted")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("unbounded transport wait")
	}
	count(t, r, "stream_events", 1)
	r.Publisher = original
	if ok, err := r.PublishOne(ctx); err != nil || ok {
		t.Fatal("retry ignored backoff", ok, err)
	}
	if _, err := r.Store.Pool.Exec(ctx, `UPDATE stream_outbox SET available_at=now() WHERE tenant_id=$1`, r.Binding.TenantID); err != nil {
		t.Fatal(err)
	}
	publish(t, r)
	if err := r.Poll(ctx, "finding", effect); err != nil {
		t.Fatal(err)
	}
	count(t, r, "jobs", 1)
}

func TestRecoveryMetadataBudgetAndLateEffectRollback(t *testing.T) {
	r, a, _ := setup(t)
	ctx := context.Background()
	publish(t, r)
	d := read(t, r)
	late := func(ctx context.Context, tx pgx.Tx, e telemetry.Event) error {
		if err := effect(ctx, tx, e); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE stream_consumer_work SET lease_until=now()-interval '1 second' WHERE tenant_id=$1`, r.Binding.TenantID)
		return err
	}
	if err := r.Process(ctx, d, "finding", late); !errors.Is(err, eventstate.ErrLease) {
		t.Fatal("late handler accepted", err)
	}
	count(t, r, "jobs", 0)
	count(t, r, "stream_inbox", 0)
	// One work record occupies the quota; poison must remain pending, not vanish.
	r.MaxRecoveryRecords = 1
	key, _ := streams.Key(r.Binding)
	if err := a.XAdd(ctx, &redis.XAddArgs{Stream: key, Values: map[string]any{"raw": "poison"}}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := r.Process(ctx, read(t, r), "finding", effect); !errors.Is(err, eventstate.ErrCapacity) {
		t.Fatal("budget exceeded", err)
	}
	if n, err := r.Consumer.Pending(ctx, r.Binding, r.Processor); err != nil || n != 2 {
		t.Fatal(n, err)
	}
}
