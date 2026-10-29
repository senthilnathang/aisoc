package streams

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"aisoc/backend/internal/modules/telemetry"
)

var ErrBackpressure = errors.New("stream capacity reached")

// The capacity check and append execute atomically; concurrent publishers cannot
// exceed the configured entry count. It never trims unprocessed payloads.
const boundedAppend = `if redis.call('XLEN', KEYS[1]) >= tonumber(ARGV[1]) then return redis.error_reply('AISOC_BACKPRESSURE') end
return redis.call('XADD', KEYS[1], '*', 'schema_version', '1.0', 'event_key', ARGV[2], 'content_hash', ARGV[3], 'envelope', ARGV[4])`

func (c *Client) PublishBounded(ctx context.Context, b telemetry.Binding, e telemetry.Event, maxEntries int64) (string, error) {
	key, err := Key(b)
	if err != nil {
		return "", err
	}
	if maxEntries < 1 || maxEntries > 100000 {
		return "", ErrInvalid
	}
	if err = e.Validate(b); err != nil {
		return "", err
	}
	raw, err := json.Marshal(e)
	if err != nil || len(raw) > telemetry.MaxEnvelopeBytes {
		return "", ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	id, err := c.redis.Eval(ctx, boundedAppend, []string{key}, maxEntries, e.Identity(), e.ContentHash(), string(raw)).Text()
	if err != nil && (strings.Contains(err.Error(), "AISOC_BACKPRESSURE") || strings.HasPrefix(err.Error(), "OOM ")) {
		return "", ErrBackpressure
	}
	return id, err
}

func (c *Client) Entry(ctx context.Context, b telemetry.Binding, id string) (*Delivery, error) {
	key, err := Key(b)
	if err != nil {
		return nil, err
	}
	if len(id) > 128 || !idPattern.MatchString(id) {
		return nil, ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	entries, err := c.redis.XRangeN(ctx, key, id, id, 1).Result()
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}
	d := decode(b, entries[0])
	return &d, nil
}
