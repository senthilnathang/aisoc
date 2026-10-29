package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
)

type Snapshot struct {
	Accepted             int64   `json:"accepted"`
	Completed            int64   `json:"completed"`
	Dead                 int64   `json:"dead_without_disposition"`
	Pending              int64   `json:"pending"`
	OldestPendingSeconds float64 `json:"oldest_pending_seconds"`
	PublicationFailed    int64   `json:"publication_failed"`
	HistoricalGaps       int64   `json:"historical_gap_observations"`
	DeadLetters          int64   `json:"dead_letters"`
}

// Snapshot reports one SQL snapshot. Accepted = completed + dead + pending;
// transport failures/gaps/DLQ observations overlap and must not be added to it.
func (s Store) Snapshot(ctx context.Context, b telemetry.Binding, processor string) (Snapshot, error) {
	var r Snapshot
	if !validBinding(b) || !idPattern.MatchString(processor) {
		return r, ErrInvalid
	}
	// Materialize once: aggregate predicates otherwise repeat the correlated
	// inbox lookup for every count/age expression. This is query-local, not a cache.
	err := s.Pool.QueryRow(ctx, `WITH states AS MATERIALIZED (
 SELECT e.created_at,
 EXISTS(SELECT 1 FROM stream_inbox i WHERE i.tenant_id=$1 AND i.connector_id=$2 AND i.source=$3 AND i.processor=$4 AND i.event_key=e.event_key) AS completed,
 EXISTS(SELECT 1 FROM stream_consumer_work w WHERE w.tenant_id=$1 AND w.connector_id=$2 AND w.source=$3 AND w.processor=$4 AND w.work_key='event:'||e.event_key AND w.state='dead') AS dead
 FROM stream_events e
 WHERE e.tenant_id=$1 AND e.connector_id=$2 AND e.source=$3)
 SELECT count(*),count(*) FILTER(WHERE completed),count(*) FILTER(WHERE NOT completed AND dead),count(*) FILTER(WHERE NOT completed AND NOT dead),
 COALESCE(GREATEST(0,extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE NOT completed AND NOT dead))),0),
 (SELECT count(*) FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND state='failed'),
 (SELECT count(*) FROM stream_replay_gaps WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4),
 (SELECT count(*) FROM stream_dead_letters WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4)
 FROM states`, b.TenantID, b.ConnectorID, b.Source, processor).Scan(&r.Accepted, &r.Completed, &r.Dead, &r.Pending, &r.OldestPendingSeconds, &r.PublicationFailed, &r.HistoricalGaps, &r.DeadLetters)
	return r, err
}
func (s Store) Committed(ctx context.Context, b telemetry.Binding, processor, key, hash string) (bool, error) {
	if !validBinding(b) || !idPattern.MatchString(processor) || !hashPattern.MatchString(key) || !hashPattern.MatchString(hash) {
		return false, ErrInvalid
	}
	var done bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_inbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND event_key=$5 AND content_hash=$6)`, b.TenantID, b.ConnectorID, b.Source, processor, key, hash).Scan(&done)
	return done, err
}
