package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5"
)

type BatchEvent struct{ Key, Hash string }

// ApplyFreshBatch commits only fresh, database-only effects in one transaction.
// Existing work, replay and poison stay on the leased per-event recovery path.
// A crash rolls back the whole batch; Redis ACK must follow successful commit.
func (s Store) ApplyFreshBatch(ctx context.Context, b telemetry.Binding, processor string, input []BatchEvent, disposition string, maxAttempts int, limit int64, effect func(context.Context, pgx.Tx, telemetry.Event) error) (bool, error) {
	if !validBinding(b) || !idPattern.MatchString(processor) || len(input) < 2 || len(input) > 100 || effect == nil || maxAttempts < 1 || maxAttempts > 10 || limit < 1 || limit > 100000 || (disposition != "filtered" && disposition != "finding" && disposition != "rejected") {
		return false, ErrInvalid
	}
	keys := make([]string, len(input))
	hashes := make([]string, len(input))
	expected := map[string]string{}
	for i, e := range input {
		if !hashPattern.MatchString(e.Key) || !hashPattern.MatchString(e.Hash) {
			return false, ErrInvalid
		}
		if _, ok := expected[e.Key]; ok {
			return false, nil
		}
		keys[i], hashes[i], expected[e.Key] = e.Key, e.Hash, e.Hash
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if err = lockMetadata(ctx, tx, b, processor); err != nil {
		return false, err
	}
	var exists bool
	var retained int64
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM unnest($5::text[]) k CROSS JOIN LATERAL (SELECT 1 FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key='event:'||k OFFSET 0) w) OR EXISTS(SELECT 1 FROM unnest($5::text[]) k CROSS JOIN LATERAL (SELECT 1 FROM stream_inbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND event_key=k OFFSET 0) i),COALESCE((SELECT retained_records FROM stream_metadata_budgets WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4),0)`, pgx.QueryExecModeExec, b.TenantID, b.ConnectorID, b.Source, processor, keys).Scan(&exists, &retained); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	if retained+int64(len(input)) > limit {
		return false, ErrCapacity
	}
	rows, err := tx.Query(ctx, `SELECT e.event_key,e.content_hash,e.envelope FROM unnest($4::text[]) k CROSS JOIN LATERAL (SELECT event_key,content_hash,envelope FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=k OFFSET 0) e ORDER BY e.event_key`, b.TenantID, b.ConnectorID, b.Source, keys)
	if err != nil {
		return false, err
	}
	events := []telemetry.Event{}
	for rows.Next() {
		var key, hash string
		var raw []byte
		if err = rows.Scan(&key, &hash, &raw); err != nil {
			break
		}
		var e telemetry.Event
		e, err = telemetry.Decode(raw, b)
		if err != nil {
			break
		}
		if hash != expected[key] || e.Identity() != key || e.ContentHash() != hash {
			err = ErrConflict
			break
		}
		events = append(events, e)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return false, err
	}
	if len(events) != len(input) {
		return false, ErrNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO stream_consumer_work(tenant_id,connector_id,source,processor,work_key,state,attempts,max_attempts) SELECT $1,$2,$3,$4,'event:'||unnest($5::text[]),'done',1,$6`, b.TenantID, b.ConnectorID, b.Source, processor, keys, maxAttempts); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO stream_inbox(tenant_id,connector_id,source,processor,event_key,content_hash,disposition) SELECT $1,$2,$3,$4,k,h,$7 FROM unnest($5::text[],$6::text[]) AS x(k,h)`, b.TenantID, b.ConnectorID, b.Source, processor, keys, hashes, disposition); err != nil {
		return false, err
	}
	for _, e := range events {
		if err = effect(ctx, tx, e); err != nil {
			return false, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
