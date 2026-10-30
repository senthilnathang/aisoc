package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5"
	"sort"
)

type PublicationReceipt struct {
	Lease     Lease
	MessageID string
}

// MarkPublishedBatch commits receipts together only if every event still owns its
// unexpired attempt. Redis writes may precede a failed commit; replay remains safe.
func (s Store) MarkPublishedBatch(ctx context.Context, b telemetry.Binding, receipts []PublicationReceipt) error {
	if !validBinding(b) || len(receipts) < 1 || len(receipts) > telemetry.MaxBatchEvents {
		return ErrInvalid
	}
	// Concurrent overlapping batches must acquire row locks in the same order.
	// Copy the caller slice so sorting cannot race another publisher.
	receipts = append([]PublicationReceipt(nil), receipts...)
	sort.Slice(receipts, func(i, j int) bool { return receipts[i].Lease.EventKey < receipts[j].Lease.EventKey })
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
	// Lock the bounded primary-key set in stable order. The explicit tuple-ID
	// restriction bounds the UPDATE target even when source statistics are cold.
	// Tuple IDs never escape this statement; leases are rechecked after locking.
	var updated int
	err = tx.QueryRow(ctx, `WITH locked AS MATERIALIZED (
 SELECT ctid,event_key,attempt_id,state,lease_until FROM stream_outbox
 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=ANY($4::text[])
 ORDER BY event_key FOR UPDATE
), receipts AS MATERIALIZED (
 SELECT l.ctid,i.m FROM locked l JOIN unnest($4::text[],$5::text[],$6::text[]) AS i(k,a,m)
 ON l.event_key=i.k AND l.attempt_id::text=i.a
 WHERE l.state='publishing' AND l.lease_until>clock_timestamp()
), changed AS (
 UPDATE stream_outbox o SET state='published',published_at=now(),message_id=r.m,
 lease_until=NULL,error_code=NULL,updated_at=now() FROM receipts r
 WHERE o.ctid=ANY(ARRAY(SELECT ctid FROM receipts)) AND o.ctid=r.ctid RETURNING 1
) SELECT count(*) FROM changed`, pgx.QueryExecModeExec, b.TenantID, b.ConnectorID, b.Source, keys, attempts, ids).Scan(&updated)
	if err != nil {
		return err
	}
	if updated != len(receipts) {
		return ErrLease
	}
	return tx.Commit(ctx)
}
