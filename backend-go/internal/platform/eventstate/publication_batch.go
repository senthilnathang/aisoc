package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5"
)

type PublicationReceipt struct {
	Lease     Lease
	MessageID string
}

// MarkPublishedBatch commits receipts together only if every event still owns its
// unexpired attempt. Redis writes may precede a failed commit; replay remains safe.
func (s Store) MarkPublishedBatch(ctx context.Context, b telemetry.Binding, receipts []PublicationReceipt) error {
	if !validBinding(b) || len(receipts) < 1 || len(receipts) > 100 {
		return ErrInvalid
	}
	keys, attempts, ids := []string{}, []string{}, []string{}
	seen := map[string]bool{}
	for _, r := range receipts {
		if !hashPattern.MatchString(r.Lease.EventKey) || seen[r.Lease.EventKey] || len(r.MessageID) > 128 || !messagePattern.MatchString(r.MessageID) {
			return ErrInvalid
		}
		seen[r.Lease.EventKey] = true
		keys = append(keys, r.Lease.EventKey)
		attempts = append(attempts, r.Lease.AttemptID)
		ids = append(ids, r.MessageID)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Pipeline exact-key updates on one connection and transaction. A generic
	// join plan must not scan all retained receipts for a small supplied batch.
	batch := &pgx.Batch{}
	for i, key := range keys {
		batch.Queue(`UPDATE stream_outbox SET state='published',published_at=now(),message_id=$6,lease_until=NULL,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 AND attempt_id::text=$5 AND state='publishing' AND lease_until>clock_timestamp()`, b.TenantID, b.ConnectorID, b.Source, key, attempts[i], ids[i])
	}
	results := tx.SendBatch(ctx, batch)
	for range keys {
		tag, e := results.Exec()
		if e != nil {
			results.Close()
			return e
		}
		if tag.RowsAffected() != 1 {
			results.Close()
			return ErrLease
		}
	}
	if err = results.Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
