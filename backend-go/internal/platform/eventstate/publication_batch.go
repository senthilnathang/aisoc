package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
)

type PublicationReceipt struct {
	Lease     Lease
	MessageID string
}

// MarkPublishedBatch commits receipts together only if every event still owns its
// unexpired attempt. Redis writes may precede a failed commit; replay remains safe.
func (s Store) MarkPublishedBatch(ctx context.Context, b telemetry.Binding, receipts []PublicationReceipt) error {
	if !validBinding(b) || len(receipts) < 1 || len(receipts) > 25 {
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
	tag, err := tx.Exec(ctx, `UPDATE stream_outbox o SET state='published',published_at=now(),message_id=r.message_id,lease_until=NULL,error_code=NULL,updated_at=now()
 FROM unnest($4::text[],$5::text[],$6::text[]) AS r(event_key,attempt_id,message_id)
 WHERE o.tenant_id=$1 AND o.connector_id=$2 AND o.source=$3 AND o.event_key=r.event_key AND o.attempt_id::text=r.attempt_id AND o.state='publishing' AND o.lease_until>clock_timestamp()`, b.TenantID, b.ConnectorID, b.Source, keys, attempts, ids)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != int64(len(receipts)) {
		return ErrLease
	}
	return tx.Commit(ctx)
}
