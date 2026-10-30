// Package eventstate owns durable streaming acceptance and processing boundaries.
// It performs no Redis/provider I/O. Callers must authenticate source bindings.
package eventstate

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"aisoc/backend/internal/modules/telemetry"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrCheckpoint  = errors.New("source checkpoint changed")
	ErrConflict    = errors.New("stream event identity has conflicting content or disposition")
	ErrCapacity    = errors.New("stream recovery storage budget exhausted")
	ErrLease       = errors.New("publication attempt no longer owns a valid lease")
	ErrNotFound    = errors.New("stream event not found")
	ErrInvalid     = errors.New("invalid stream state request")
	idPattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
	hashPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	messagePattern = regexp.MustCompile(`^[0-9]+-[0-9]+$`)
)

// Limits apply per source binding to ALL retained recovery envelopes, including
// published ones. Retention is deliberate; publication alone permits no deletion.
type Store struct {
	Pool            *pgxpool.Pool
	MaxEvents       int64
	MaxPayloadBytes int64
}
type Checkpoint struct {
	Cursor  string
	Version int64
}
type Accepted struct {
	Checkpoint Checkpoint
	Inserted   int
}
type Lease struct {
	EventKey, ContentHash, AttemptID string
	Envelope                         []byte
	Attempts                         int
}

func validBinding(b telemetry.Binding) bool {
	return len(b.TenantID) <= 120 && idPattern.MatchString(b.TenantID) && idPattern.MatchString(b.ConnectorID) && idPattern.MatchString(b.Source)
}

func (s Store) Checkpoint(ctx context.Context, b telemetry.Binding) (Checkpoint, error) {
	var c Checkpoint
	if !validBinding(b) {
		return c, ErrInvalid
	}
	err := s.Pool.QueryRow(ctx, `SELECT cursor,version FROM stream_source_checkpoints WHERE tenant_id=$1 AND connector_id=$2 AND source=$3`, b.TenantID, b.ConnectorID, b.Source).Scan(&c.Cursor, &c.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, nil
	}
	return c, err
}

// Accept commits a source checkpoint, validated envelopes and publication intent
// together. A lost response is reconciled by reading Checkpoint; stale requests
// cannot advance it. An empty batch can advance an empty source page.
func (s Store) Accept(ctx context.Context, b telemetry.Binding, expected Checkpoint, next string, events []telemetry.Event) (Accepted, error) {
	var result Accepted
	if !validBinding(b) || expected.Version < 0 || len(events) > 100 || len(next) == 0 || len(next) > 2048 || !utf8.ValidString(next) || strings.ContainsRune(next, 0) {
		return result, ErrInvalid
	}
	if s.MaxEvents <= 0 || s.MaxPayloadBytes <= 0 {
		return result, ErrInvalid
	}
	raw := make([][]byte, len(events))
	keys := make([]string, len(events))
	hashes := make([]string, len(events))
	batchHashes := make(map[string]string, len(events))
	for i, e := range events {
		if err := e.Validate(b); err != nil {
			return result, err
		}
		var err error
		raw[i], err = json.Marshal(e)
		if err != nil || len(raw[i]) > telemetry.MaxEnvelopeBytes {
			return result, ErrInvalid
		}
		keys[i], hashes[i] = e.Identity(), e.ContentHash()
		if prior, exists := batchHashes[keys[i]]; exists && prior != hashes[i] {
			return result, ErrConflict
		}
		batchHashes[keys[i]] = hashes[i]
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO stream_source_checkpoints(tenant_id,connector_id,source) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source)
	if err != nil {
		return result, err
	}
	var current Checkpoint
	err = tx.QueryRow(ctx, `SELECT cursor,version FROM stream_source_checkpoints WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 FOR NO KEY UPDATE`, b.TenantID, b.ConnectorID, b.Source).Scan(&current.Cursor, &current.Version)
	if err != nil {
		return result, err
	}
	if current != expected {
		return result, ErrCheckpoint
	}
	var count, size, total int64
	err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT hot_events FROM stream_payload_budgets WHERE tenant_id=$1 AND connector_id=$2 AND source=$3),0),COALESCE((SELECT hot_bytes FROM stream_payload_budgets WHERE tenant_id=$1 AND connector_id=$2 AND source=$3),0),COALESCE((SELECT total_events FROM stream_payload_budgets WHERE tenant_id=$1 AND connector_id=$2 AND source=$3),0)`, b.TenantID, b.ConnectorID, b.Source).Scan(&count, &size, &total)
	if err != nil {
		return result, err
	}
	rows, err := tx.Query(ctx, `SELECT e.event_key,e.content_hash FROM unnest($4::text[]) k CROSS JOIN LATERAL (SELECT event_key,content_hash FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=k OFFSET 0) e`, b.TenantID, b.ConnectorID, b.Source, keys)
	if err != nil {
		return Accepted{}, err
	}
	known := make(map[string]string, len(events))
	for rows.Next() {
		var key, hash string
		if err = rows.Scan(&key, &hash); err != nil {
			rows.Close()
			return Accepted{}, err
		}
		known[key] = hash
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Accepted{}, err
	}
	newKeys, newHashes := []string{}, []string{}
	newRaw := [][]byte{}
	for i := range events {
		if prior, exists := known[keys[i]]; exists {
			if prior != hashes[i] {
				return Accepted{}, ErrConflict
			}
			continue
		}
		if count >= s.MaxEvents || total >= 100000 || int64(len(raw[i])) > s.MaxPayloadBytes-size {
			return Accepted{}, ErrCapacity
		}
		known[keys[i]] = hashes[i]
		newKeys = append(newKeys, keys[i])
		total++
		newHashes = append(newHashes, hashes[i])
		newRaw = append(newRaw, raw[i])
		count++
		size += int64(len(raw[i]))
		result.Inserted++
	}
	if len(newKeys) > 0 {
		_, err = tx.Exec(ctx, `INSERT INTO stream_events(tenant_id,connector_id,source,event_key,content_hash,envelope) SELECT $1,$2,$3,k,h,e FROM unnest($4::text[],$5::text[],$6::bytea[]) AS batch(k,h,e)`, b.TenantID, b.ConnectorID, b.Source, newKeys, newHashes, newRaw)
		if err != nil {
			return Accepted{}, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO stream_outbox(tenant_id,connector_id,source,event_key) SELECT $1,$2,$3,k FROM unnest($4::text[]) AS batch(k)`, b.TenantID, b.ConnectorID, b.Source, newKeys)
		if err != nil {
			return Accepted{}, err
		}
	}
	err = tx.QueryRow(ctx, `UPDATE stream_source_checkpoints SET cursor=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 RETURNING cursor,version`, b.TenantID, b.ConnectorID, b.Source, next).Scan(&result.Checkpoint.Cursor, &result.Checkpoint.Version)
	if err != nil {
		return Accepted{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Accepted{}, err
	}
	return result, nil
}

// Claim uses one SQL statement to acquire a 30-second lease. Publish outside SQL
// transactions, then MarkPublished. Lost acknowledgments may cause redelivery.
func (s Store) Claim(ctx context.Context, b telemetry.Binding) (*Lease, error) {
	leases, err := s.ClaimBatch(ctx, b, 1)
	if err != nil || len(leases) == 0 {
		return nil, err
	}
	return &leases[0], nil
}

// ClaimBatch retains per-event leases, attempts and receipts. The correlated
// envelope lookup avoids source-wide nested-loop scans with cold statistics.
func (s Store) ClaimBatch(ctx context.Context, b telemetry.Binding, limit int) ([]Lease, error) {
	if !validBinding(b) || limit < 1 || limit > 100 {
		return nil, ErrInvalid
	}
	_, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET state='failed',lease_until=NULL,error_code='ATTEMPTS_EXHAUSTED',updated_at=now()
 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND state='publishing' AND lease_until<=clock_timestamp() AND attempts>=max_attempts`, b.TenantID, b.ConnectorID, b.Source)
	if err != nil {
		return nil, err
	}
	// The locked CTIDs live only inside this statement on this unpartitioned
	// table. A bounded TID update avoids rescanning all retained source receipts.
	rows, err := s.Pool.Query(ctx, `WITH candidate AS MATERIALIZED (
 SELECT ctid FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND attempts<max_attempts AND
 ((state='queued' AND available_at<=clock_timestamp()) OR (state='publishing' AND lease_until<=clock_timestamp()))
 ORDER BY available_at,created_at,event_key FOR UPDATE SKIP LOCKED LIMIT $4), claimed AS (
 UPDATE stream_outbox o SET state='publishing',attempt_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval '30 seconds',updated_at=now()
 WHERE o.ctid=ANY(ARRAY(SELECT ctid FROM candidate)) RETURNING o.event_key,o.attempts,o.attempt_id)
 SELECT c.event_key,e.content_hash,e.envelope,c.attempts,c.attempt_id::text FROM claimed c CROSS JOIN LATERAL
 (SELECT content_hash,envelope FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=c.event_key OFFSET 0) e`, pgx.QueryExecModeExec, b.TenantID, b.ConnectorID, b.Source, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	leases := make([]Lease, 0, limit)
	for rows.Next() {
		l := Lease{}
		if err = rows.Scan(&l.EventKey, &l.ContentHash, &l.Envelope, &l.Attempts, &l.AttemptID); err != nil {
			return nil, err
		}
		leases = append(leases, l)
	}
	return leases, rows.Err()
}

func (s Store) MarkPublished(ctx context.Context, b telemetry.Binding, l Lease, messageID string) error {
	if !validBinding(b) || !hashPattern.MatchString(l.EventKey) || len(messageID) > 128 || !messagePattern.MatchString(messageID) {
		return ErrInvalid
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET state='published',published_at=now(),message_id=$6,lease_until=NULL,error_code=NULL,updated_at=now()
 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 AND attempt_id::text=$5 AND state='publishing' AND lease_until>clock_timestamp()`, b.TenantID, b.ConnectorID, b.Source, l.EventKey, l.AttemptID, messageID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrLease
	}
	return nil
}

// Retry schedules a failed publication; the stream runtime will supply bounded
// exponential backoff/jitter in S04. Exhausted attempts remain visible, not deleted.
func (s Store) Retry(ctx context.Context, b telemetry.Binding, l Lease, delay time.Duration) error {
	if !validBinding(b) || !hashPattern.MatchString(l.EventKey) || delay < time.Second || delay > time.Minute {
		return ErrInvalid
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET state=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
 lease_until=NULL,error_code='PUBLISH_FAILED',available_at=clock_timestamp()+($6::bigint*interval '1 millisecond'),updated_at=now()
 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 AND attempt_id::text=$5 AND state='publishing' AND lease_until>clock_timestamp()`, b.TenantID, b.ConnectorID, b.Source, l.EventKey, l.AttemptID, delay.Milliseconds())
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrLease
	}
	return nil
}

// Apply commits an inbox disposition and DB-only effects in the same transaction.
// A false result means an identical disposition was already committed. The caller
// may ACK only after success. The callback must not commit/rollback or perform
// network I/O; use the supplied transaction for jobs/audit/next outbox records.
func (s Store) Apply(ctx context.Context, b telemetry.Binding, processor, key, hash, disposition string, effect func(context.Context, pgx.Tx, telemetry.Event) error) (bool, error) {
	if !validBinding(b) || !idPattern.MatchString(processor) || !hashPattern.MatchString(key) || !hashPattern.MatchString(hash) {
		return false, ErrInvalid
	}
	if disposition != "filtered" && disposition != "finding" && disposition != "rejected" {
		return false, ErrInvalid
	}
	if effect == nil {
		return false, ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var storedHash string
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT content_hash,envelope FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 FOR SHARE`, b.TenantID, b.ConnectorID, b.Source, key).Scan(&storedHash, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if storedHash != hash {
		return false, ErrConflict
	}
	raw, err = ResolveEnvelope(ctx, tx, b, key, raw)
	if err != nil {
		return false, err
	}
	e, err := telemetry.Decode(raw, b)
	if err != nil {
		return false, err
	}
	if e.Identity() != key || e.ContentHash() != hash {
		return false, ErrConflict
	}
	tag, err := tx.Exec(ctx, `INSERT INTO stream_inbox(tenant_id,connector_id,source,processor,event_key,content_hash,disposition) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source, processor, key, hash, disposition)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		var priorHash, priorDisposition string
		err = tx.QueryRow(ctx, `SELECT content_hash,disposition FROM stream_inbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND event_key=$5`, b.TenantID, b.ConnectorID, b.Source, processor, key).Scan(&priorHash, &priorDisposition)
		if err != nil {
			return false, err
		}
		if priorHash != hash || priorDisposition != disposition {
			return false, ErrConflict
		}
		return false, tx.Commit(ctx)
	}
	if err = effect(ctx, tx, e); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
