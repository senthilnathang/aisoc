package enrichment

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"fmt"
	"github.com/redis/go-redis/v9"
	"net"
	"os"
	"sync"
	"testing"
	"time"
)

func setup(t *testing.T) (Store, *redis.Client, string) {
	t.Helper()
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	addr := os.Getenv("AISOC_TEST_REDIS_ADDR")
	if url == "" || addr == "" {
		t.Skip("run check.py --with-streams")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 6)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	cache, err := NewCache(addr, "aisoc-cache", os.Getenv("AISOC_TEST_REDIS_CACHE_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cache.Close() })
	admin := redis.NewClient(&redis.Options{Addr: addr, Username: "aisoc-admin", Password: os.Getenv("AISOC_TEST_REDIS_ADMIN_PASSWORD"), Protocol: 2, DisableIdentity: true})
	t.Cleanup(func() { admin.Close() })
	tenant := "cache-" + jobs.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO threat_intel_reports(tenant_id,id,title,severity,published_at,created_at,updated_at) VALUES($1,'report','mock','high',now(),now(),now())`, tenant); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		admin.Del(ctx, cacheKey(tenant))
		pool.Exec(ctx, `DELETE FROM threat_intel_reports WHERE tenant_id=$1`, tenant)
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant); err != nil {
			t.Error(err)
		}
	})
	return Store{Pool: pool, Cache: cache}, admin, tenant
}
func add(t *testing.T, s Store, tenant, id, value string) {
	t.Helper()
	if _, err := s.Pool.Exec(context.Background(), `INSERT INTO threat_indicators(tenant_id,id,report_id,indicator_type,value,severity,status,created_at,updated_at) VALUES($1,$2,'report','ip',$3,'high','active',now(),now())`, tenant, id, value); err != nil {
		t.Fatal(err)
	}
}
func lookup(t *testing.T, s Store, tenant, value string) Result {
	t.Helper()
	r, err := s.Lookup(context.Background(), tenant, "ip", value)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestCacheHitsInvalidationAndNegativeResults(t *testing.T) {
	s, _, tenant := setup(t)
	ctx := context.Background()
	value := "192.0.2.1"
	first := lookup(t, s, tenant, value)
	if first.CacheStatus != "miss" || len(first.Matches) != 0 || first.ExpiresAt.Sub(first.RetrievedAt) != 5*time.Second {
		t.Fatal(first)
	}
	if hit := lookup(t, s, tenant, value); hit.CacheStatus != "hit" {
		t.Fatal(hit)
	}
	add(t, s, tenant, "ioc-1", value)
	positive := lookup(t, s, tenant, value)
	if positive.CacheStatus != "miss" || len(positive.Matches) != 1 || positive.Generation == first.Generation {
		t.Fatal(positive)
	}
	if hit := lookup(t, s, tenant, value); hit.CacheStatus != "hit" || !hit.RetrievedAt.Equal(positive.RetrievedAt) {
		t.Fatal(hit)
	}
	// Failed source mutations must not invalidate the committed generation.
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE threat_indicators SET status='expired' WHERE tenant_id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	tx.Rollback(ctx)
	if r := lookup(t, s, tenant, value); r.CacheStatus != "hit" {
		t.Fatal("rollback changed generation", r)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE threat_indicators SET status='false_positive' WHERE tenant_id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	if r := lookup(t, s, tenant, value); r.CacheStatus != "miss" || len(r.Matches) != 0 {
		t.Fatal(r)
	}
	if _, err = s.Pool.Exec(ctx, `DELETE FROM threat_indicators WHERE tenant_id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	if r := lookup(t, s, tenant, value); r.CacheStatus != "miss" {
		t.Fatal(r)
	}
}
func TestCacheIsolationCorruptionAndExpiry(t *testing.T) {
	s, a, tenant := setup(t)
	other, _, foreign := setup(t)
	ctx := context.Background()
	value := "192.0.2.2"
	add(t, s, tenant, "ioc-a", value)
	add(t, other, foreign, "ioc-b", value)
	own := lookup(t, s, tenant, value)
	alien := lookup(t, other, foreign, value)
	if own.Matches[0].ID == alien.Matches[0].ID {
		t.Fatal("tenant collision")
	}
	key := field("ip", value, own.Generation)
	raw, _ := json.Marshal(alien)
	if err := a.HSet(ctx, cacheKey(tenant), key, raw).Err(); err != nil {
		t.Fatal(err)
	}
	if r := lookup(t, s, tenant, value); r.CacheStatus != "miss" || r.Matches[0].ID != "ioc-a" {
		t.Fatal(r)
	}
	expired := own
	expired.RetrievedAt = time.Now().UTC().Add(-31 * time.Second)
	expired.ExpiresAt = expired.RetrievedAt.Add(30 * time.Second)
	raw, _ = json.Marshal(expired)
	a.HSet(ctx, cacheKey(tenant), key, raw)
	if r := lookup(t, s, tenant, value); r.CacheStatus != "miss" {
		t.Fatal("expired hit", r)
	}
	a.HSet(ctx, cacheKey(tenant), key, "{\"tenant\":\"injected\"}")
	if r := lookup(t, s, tenant, value); r.CacheStatus != "miss" {
		t.Fatal(r)
	}
	if _, err := s.Lookup(ctx, "missing-tenant", "ip", value); err == nil {
		t.Fatal("missing tenant")
	}
}
func TestCacheCapacityACLAndOutageFallback(t *testing.T) {
	s, a, tenant := setup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 160)
	for i := 0; i < 160; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.Cache.put(ctx, tenant, fmt.Sprint(i), []byte("{}"))
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n, err := a.HLen(ctx, cacheKey(tenant)).Result(); err != nil || n != 128 {
		t.Fatal(n, err)
	}
	if ttl, err := a.PTTL(ctx, cacheKey(tenant)).Result(); err != nil || ttl <= 0 || ttl > time.Minute {
		t.Fatal(ttl, err)
	}
	add(t, s, tenant, "ioc", "192.0.2.3")
	if r := lookup(t, s, tenant, "192.0.2.3"); r.CacheStatus != "capacity" || len(r.Matches) != 1 {
		t.Fatal(r)
	}
	if err := s.Cache.client.XAdd(ctx, &redis.XAddArgs{Stream: "soc:telemetry:forbidden", Values: map[string]any{"x": "y"}}).Err(); err == nil {
		t.Fatal("cache role wrote telemetry")
	}
	if err := s.Cache.client.Get(ctx, "soc:cache:ioc:forbidden").Err(); err == nil || err == redis.Nil {
		t.Fatal("cache role unrestricted GET")
	}
	// A non-responsive local listener models an unavailable Redis transport.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			c, e := listener.Accept()
			if e != nil {
				return
			}
			go func() { defer c.Close(); <-done }()
		}
	}()
	blocked, err := NewCache(listener.Addr().String(), "aisoc-cache", "01234567890123456789012345678901")
	if err != nil {
		t.Fatal(err)
	}
	defer blocked.Close()
	started := time.Now()
	fallback := lookup(t, Store{Pool: s.Pool, Cache: blocked}, tenant, "192.0.2.3")
	if time.Since(started) > 2*time.Second || fallback.CacheStatus != "unavailable" || len(fallback.Matches) != 1 {
		t.Fatal(fallback)
	}
}
func TestCacheTruncationAndSourceFailure(t *testing.T) {
	s, _, tenant := setup(t)
	ctx := context.Background()
	for i := 0; i < 33; i++ {
		add(t, s, tenant, fmt.Sprintf("ioc-%d", i), "192.0.2.4")
	}
	r := lookup(t, s, tenant, "192.0.2.4")
	if len(r.Matches) != 32 || !r.Truncated {
		t.Fatal(r)
	}
	// Cache presence never permits a lookup to bypass the authoritative source.
	failedPool, err := database.Open(ctx, os.Getenv("AISOC_GO_TEST_DATABASE_URL"), 2)
	if err != nil {
		t.Fatal(err)
	}
	failedPool.Close()
	if _, err := (Store{Pool: failedPool, Cache: s.Cache}).Lookup(ctx, tenant, "ip", "192.0.2.4"); err == nil {
		t.Fatal("cached response bypassed failed source")
	}
}
