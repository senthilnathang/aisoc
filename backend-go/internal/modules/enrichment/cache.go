package enrichment

import (
	"aisoc/backend/internal/platform/config"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"strings"
	"time"
)

// One bounded hash per tenant, with non-sliding whole-key expiry. Logical entries
// have shorter TTLs; no unbounded per-query Redis keys or telemetry eviction.
const readScript = `if redis.call('HSTRLEN',KEYS[1],ARGV[1])>8192 then return false end return redis.call('HGET',KEYS[1],ARGV[1])`
const putScript = `if redis.call('HEXISTS',KEYS[1],ARGV[1])==0 and redis.call('HLEN',KEYS[1])>=128 then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]) if redis.call('PTTL',KEYS[1])<0 then redis.call('PEXPIRE',KEYS[1],60000) end return 1`

type Cache struct{ client *redis.Client }

func NewCache(address, username, password string) (*Cache, error) {
	if config.Loopback(address) != nil || username != "aisoc-cache" || len(password) < 32 || strings.ContainsAny(password, "\r\n") {
		return nil, ErrInvalid
	}
	return &Cache{client: redis.NewClient(&redis.Options{Addr: address, Username: username, Password: password, Protocol: 2, DisableIdentity: true, MaxRetries: -1, PoolSize: 2, MaxActiveConns: 2, DialTimeout: 150 * time.Millisecond, ReadTimeout: 150 * time.Millisecond, WriteTimeout: 150 * time.Millisecond, PoolTimeout: 150 * time.Millisecond, ContextTimeoutEnabled: true})}, nil
}
func (c *Cache) Close() error { return c.client.Close() }
func digest(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func cacheKey(tenant string) string               { return "soc:cache:ioc:" + digest(tenant) }
func field(kind, value, generation string) string { return digest([]string{kind, value, generation}) }
func (c *Cache) get(ctx context.Context, tenant, key string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	raw, err := c.client.Eval(ctx, readScript, []string{cacheKey(tenant)}, key).Text()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	return []byte(raw), err
}
func (c *Cache) put(ctx context.Context, tenant, key string, raw []byte) (bool, error) {
	if len(raw) > 8192 {
		return false, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	n, err := c.client.Eval(ctx, putScript, []string{cacheKey(tenant)}, key, raw).Int()
	return n == 1, err
}
