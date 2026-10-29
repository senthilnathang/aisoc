// Package streams is the bounded Redis telemetry transport. PostgreSQL owns
// durable acceptance, processing effects and retries; no method ACKs implicitly.
package streams

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/config"
	"github.com/redis/go-redis/v9"
)

const MaxBatch = 100

var (
	ErrInvalid     = errors.New("invalid stream request or delivery")
	ErrProtocol    = errors.New("invalid Redis stream response")
	namePattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	idPattern      = regexp.MustCompile(`^[0-9]+-[0-9]+$`)
	bindingPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
)

// Plaintext is confined to literal loopback for the sandbox. Remote workers must
// gain authenticated TLS support before this boundary permits remote addresses.
type Config struct{ Address, Username, Password string }
type Client struct{ redis *redis.Client }
type Delivery struct {
	ID               string
	Event            telemetry.Event
	Key, ContentHash string
	// Invalid deliveries retain their Redis ID for quarantine/recovery. Never ACK
	// these without a durable error disposition (implemented by the S04 consumer).
	Err error
}
type Claimed struct {
	Next       string
	Deliveries []Delivery
	DeletedIDs []string
}

func New(c Config) (*Client, error) {
	if config.Loopback(c.Address) != nil || !namePattern.MatchString(c.Username) || len(c.Password) < 32 || strings.ContainsAny(c.Password, "\r\n") {
		return nil, ErrInvalid
	}
	r := redis.NewClient(&redis.Options{Addr: c.Address, Username: c.Username, Password: c.Password,
		Protocol: 2, DisableIdentity: true, MaxRetries: -1, PoolSize: 4, MaxActiveConns: 4,
		DialTimeout: time.Second, ReadTimeout: 2 * time.Second, WriteTimeout: time.Second,
		PoolTimeout: time.Second, ContextTimeoutEnabled: true})
	return &Client{redis: r}, nil
}
func (c *Client) Close() error { return c.redis.Close() }

func Key(b telemetry.Binding) (string, error) {
	if len(b.TenantID) > 120 || !bindingPattern.MatchString(b.TenantID) || !bindingPattern.MatchString(b.ConnectorID) || !bindingPattern.MatchString(b.Source) {
		return "", ErrInvalid
	}
	raw, _ := json.Marshal([]string{b.TenantID, b.ConnectorID, b.Source})
	hash := sha256.Sum256(raw)
	return "soc:telemetry:{" + hex.EncodeToString(hash[:]) + "}:0", nil
}
func bounded(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 2*time.Second)
}
func (c *Client) Health(ctx context.Context) error {
	ctx, cancel := bounded(ctx)
	defer cancel()
	return c.redis.Ping(ctx).Err()
}

func (c *Client) Publish(ctx context.Context, b telemetry.Binding, e telemetry.Event) (string, error) {
	key, err := Key(b)
	if err != nil {
		return "", err
	}
	if err := e.Validate(b); err != nil {
		return "", err
	}
	raw, err := json.Marshal(e)
	if err != nil || len(raw) > telemetry.MaxEnvelopeBytes {
		return "", ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	// No MAXLEN trimming: recovery policy must account for every required group.
	return c.redis.XAdd(ctx, &redis.XAddArgs{Stream: key, Values: map[string]any{
		"schema_version": "1.0", "event_key": e.Identity(), "content_hash": e.ContentHash(), "envelope": string(raw),
	}}).Result()
}

func (c *Client) EnsureGroup(ctx context.Context, b telemetry.Binding, group string) error {
	key, err := Key(b)
	if err != nil {
		return err
	}
	if !namePattern.MatchString(group) {
		return ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	// Start from the beginning, including messages published before group creation.
	err = c.redis.XGroupCreateMkStream(ctx, key, group, "0").Err()
	if err != nil && strings.HasPrefix(err.Error(), "BUSYGROUP ") {
		return nil
	}
	return err
}

func (c *Client) Read(ctx context.Context, b telemetry.Binding, group, consumer string, count int, block time.Duration) ([]Delivery, error) {
	key, err := Key(b)
	if err != nil {
		return nil, err
	}
	if !namePattern.MatchString(group) || !namePattern.MatchString(consumer) || count < 1 || count > MaxBatch || block < time.Millisecond || block > time.Second {
		return nil, ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	streams, err := c.redis.XReadGroup(ctx, &redis.XReadGroupArgs{Group: group, Consumer: consumer, Streams: []string{key, ">"}, Count: int64(count), Block: block}).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var deliveries []Delivery
	for _, stream := range streams {
		if stream.Stream != key {
			return nil, ErrProtocol
		}
		for _, m := range stream.Messages {
			deliveries = append(deliveries, decode(b, m))
		}
	}
	return deliveries, nil
}

func decode(b telemetry.Binding, m redis.XMessage) Delivery {
	d := Delivery{ID: m.ID}
	if len(m.Values) != 4 {
		d.Err = ErrInvalid
		return d
	}
	version, ok := m.Values["schema_version"].(string)
	if !ok || version != "1.0" {
		d.Err = ErrInvalid
		return d
	}
	raw, ok := m.Values["envelope"].(string)
	if !ok {
		d.Err = ErrInvalid
		return d
	}
	d.Event, d.Err = telemetry.Decode([]byte(raw), b)
	if d.Err != nil {
		return d
	}
	d.Key, ok = m.Values["event_key"].(string)
	if !ok || d.Key != d.Event.Identity() {
		d.Err = ErrInvalid
		return d
	}
	d.ContentHash, ok = m.Values["content_hash"].(string)
	if !ok || d.ContentHash != d.Event.ContentHash() {
		d.Err = ErrInvalid
	}
	return d
}

// Reclaim preserves Redis 7's deleted-entry IDs. The typed go-redis helper omits
// these, so parse the complete RESP2 response and expose recovery gaps explicitly.
func (c *Client) Reclaim(ctx context.Context, b telemetry.Binding, group, consumer, start string, count int, minIdle time.Duration) (Claimed, error) {
	var page Claimed
	key, err := Key(b)
	if err != nil {
		return page, err
	}
	if !namePattern.MatchString(group) || !namePattern.MatchString(consumer) || len(start) > 128 || !idPattern.MatchString(start) || count < 1 || count > MaxBatch || minIdle < time.Second || minIdle > 24*time.Hour {
		return page, ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	raw, err := c.redis.Do(ctx, "XAUTOCLAIM", key, group, consumer, minIdle.Milliseconds(), start, "COUNT", count).Result()
	if err != nil {
		return page, err
	}
	parts, ok := raw.([]any)
	if !ok || len(parts) != 3 {
		return page, ErrProtocol
	}
	page.Next, ok = parts[0].(string)
	if !ok || !idPattern.MatchString(page.Next) {
		return page, ErrProtocol
	}
	messages, ok := parts[1].([]any)
	if !ok {
		return page, ErrProtocol
	}
	for _, value := range messages {
		entry, ok := value.([]any)
		if !ok || len(entry) != 2 {
			return page, ErrProtocol
		}
		id, ok := entry[0].(string)
		if !ok || !idPattern.MatchString(id) {
			return page, ErrProtocol
		}
		fields, ok := entry[1].([]any)
		if !ok || len(fields)%2 != 0 {
			return page, ErrProtocol
		}
		m := redis.XMessage{ID: id, Values: map[string]any{}}
		duplicate := false
		for i := 0; i < len(fields); i += 2 {
			name, ok := fields[i].(string)
			if !ok {
				return page, ErrProtocol
			}
			if _, exists := m.Values[name]; exists {
				duplicate = true
			}
			m.Values[name] = fields[i+1]
		}
		d := decode(b, m)
		if duplicate {
			d.Err = ErrInvalid
		}
		page.Deliveries = append(page.Deliveries, d)
	}
	deleted, ok := parts[2].([]any)
	if !ok {
		return page, ErrProtocol
	}
	for _, value := range deleted {
		id, ok := value.(string)
		if !ok || !idPattern.MatchString(id) {
			return page, ErrProtocol
		}
		page.DeletedIDs = append(page.DeletedIDs, id)
	}
	return page, nil
}

// Ack is deliberately explicit. Call only after a successful PostgreSQL Apply or
// durable failure disposition, never just because a handler returned from a RPC.
func (c *Client) Ack(ctx context.Context, b telemetry.Binding, group string, ids ...string) (int64, error) {
	key, err := Key(b)
	if err != nil {
		return 0, err
	}
	if !namePattern.MatchString(group) || len(ids) < 1 || len(ids) > MaxBatch {
		return 0, ErrInvalid
	}
	for _, id := range ids {
		if len(id) > 128 || !idPattern.MatchString(id) {
			return 0, ErrInvalid
		}
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	return c.redis.XAck(ctx, key, group, ids...).Result()
}

func (c *Client) Pending(ctx context.Context, b telemetry.Binding, group string) (int64, error) {
	key, err := Key(b)
	if err != nil {
		return 0, err
	}
	if !namePattern.MatchString(group) {
		return 0, ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	pending, err := c.redis.XPending(ctx, key, group).Result()
	if err != nil {
		return 0, err
	}
	return pending.Count, nil
}
