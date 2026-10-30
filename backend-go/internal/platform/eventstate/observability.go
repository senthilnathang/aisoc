package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5"
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
	Archived             int64   `json:"archived"`
}

// Snapshot reports one SQL snapshot. Accepted = completed + dead + pending;
// transport failures/gaps/DLQ observations overlap and must not be added to it.
func (s Store) Snapshot(ctx context.Context, b telemetry.Binding, processor string) (Snapshot, error) {
	var r Snapshot
	if !validBinding(b) || !idPattern.MatchString(processor) {
		return r, ErrInvalid
	}
	// Aggregate scoped sets once. Completed still wins over dead; unknown work
	// cannot become acceptance. Avoid a growing multi-column nested-loop join.
	// One bitwise aggregate tracks accepted=1, completed=2 and dead=4. Require
	// the accepted bit before counting; mask 6 makes completion win over death.
	err := s.Pool.QueryRow(ctx, `WITH states AS MATERIALIZED (
 SELECT event_key,min(created_at) AS created_at,bit_or(flags) AS flags FROM (
 SELECT event_key,created_at,1 AS flags FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3
 UNION ALL SELECT event_key,NULL,2 FROM stream_inbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4
 UNION ALL SELECT substring(work_key from 7),NULL,4 FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND state='dead' AND work_key LIKE 'event:%'
 ) records GROUP BY event_key HAVING (bit_or(flags)&1)=1)
 SELECT count(*),count(*) FILTER(WHERE (flags&2)=2),count(*) FILTER(WHERE (flags&6)=4),count(*) FILTER(WHERE (flags&6)=0),
 COALESCE(GREATEST(0,extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE (flags&6)=0))),0),
 (SELECT count(*) FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND state='failed'),
 (SELECT count(*) FROM stream_replay_gaps WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4),
 (SELECT count(*) FROM stream_dead_letters WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4),
 (SELECT count(*) FROM stream_event_archives WHERE tenant_id=$1 AND connector_id=$2 AND source=$3)
 FROM states`, pgx.QueryExecModeExec, b.TenantID, b.ConnectorID, b.Source, processor).Scan(&r.Accepted, &r.Completed, &r.Dead, &r.Pending, &r.OldestPendingSeconds, &r.PublicationFailed, &r.HistoricalGaps, &r.DeadLetters, &r.Archived)
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
