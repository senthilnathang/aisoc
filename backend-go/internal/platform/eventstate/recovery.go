package eventstate

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
)

type Work struct {
	Key, AttemptID, State string
	Attempts              int
}
type Publication struct{ Key, MessageID, ContentHash string }
type RecoveryStats struct{ Waiting, Running, Dead, Done, Gaps, PublicationFailed int64 }

// RetryDelay is exponential with bounded positive jitter, always 1..60 seconds.
func RetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	base := time.Second * time.Duration(1<<uint(attempt-1))
	if base > 30*time.Second {
		base = 30 * time.Second
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(base)))
	if err != nil {
		return base
	}
	return base + time.Duration(n.Int64())
}

func validWork(key string) bool {
	return (strings.HasPrefix(key, "event:") && hashPattern.MatchString(strings.TrimPrefix(key, "event:"))) ||
		(strings.HasPrefix(key, "delivery:") && len(key) <= 137 && messagePattern.MatchString(strings.TrimPrefix(key, "delivery:")))
}

// lockMetadata serializes metadata admission per source/processor independently
// from source ingestion. Hash collisions only add contention, never bypass locks.
// All admission and archive compaction paths take this transaction-scoped lock
// before reading the budget or locking work rows. No network effects are allowed.
func lockMetadata(ctx context.Context, tx pgx.Tx, b telemetry.Binding, processor string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array('aisoc-stream-metadata-v1',$1::text,$2::text,$3::text,$4::text)::text,0))`, b.TenantID, b.ConnectorID, b.Source, processor)
	return err
}

// lockBudget serializes new metadata admission. Budgets apply per source/processor.
func lockBudget(ctx context.Context, tx pgx.Tx, b telemetry.Binding, processor string, limit int64, workKey, gapID string) error {
	if !validBinding(b) || !idPattern.MatchString(processor) || limit < 1 || limit > 100000 {
		return ErrInvalid
	}
	if err := lockMetadata(ctx, tx, b, processor); err != nil {
		return err
	}
	// Keep this check after acquiring the metadata lock so it observes admissions
	// committed by the previous holder. CASE avoids counting retained rows on replay.
	var full bool
	err := tx.QueryRow(ctx, `SELECT CASE WHEN
 EXISTS(SELECT 1 FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5)
 OR EXISTS(SELECT 1 FROM stream_replay_gaps WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND message_id=$6)
 THEN false ELSE
 COALESCE((SELECT retained_records FROM stream_metadata_budgets WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4),0)>=$7 END`, b.TenantID, b.ConnectorID, b.Source, processor, workKey, gapID, limit).Scan(&full)
	if err != nil {
		return err
	}
	if full {
		return ErrCapacity
	}
	return nil
}

func (s Store) BeginWork(ctx context.Context, b telemetry.Binding, processor, key, messageID string, maxAttempts int, limit int64) (Work, error) {
	w := Work{Key: key, AttemptID: jobs.ID()}
	if !validBinding(b) || !idPattern.MatchString(processor) || !validWork(key) || !messagePattern.MatchString(messageID) || len(messageID) > 128 || maxAttempts < 1 || maxAttempts > 10 {
		return w, ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return w, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5)`, b.TenantID, b.ConnectorID, b.Source, processor, key).Scan(&exists); err != nil {
		return w, err
	}
	if !exists {
		if err = lockBudget(ctx, tx, b, processor, limit, key, ""); err != nil {
			return w, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO stream_consumer_work(tenant_id,connector_id,source,processor,work_key,max_attempts) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source, processor, key, maxAttempts)
		if err != nil {
			return w, err
		}
	}
	var due bool
	var max int
	err = tx.QueryRow(ctx, `SELECT state,attempts,max_attempts,((state='waiting' AND available_at<=clock_timestamp()) OR (state='running' AND lease_until<=clock_timestamp())) FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source, processor, key).Scan(&w.State, &w.Attempts, &max, &due)
	if err != nil {
		return w, err
	}
	if w.State == "done" || w.State == "dead" {
		return w, tx.Commit(ctx)
	}
	if !due {
		w.State = "busy"
		return w, tx.Commit(ctx)
	}
	if w.Attempts >= max {
		if err = deadTx(ctx, tx, b, processor, key, messageID, "ATTEMPTS_EXHAUSTED"); err != nil {
			return w, err
		}
		w.State = "dead"
		return w, tx.Commit(ctx)
	}
	_, err = tx.Exec(ctx, `UPDATE stream_consumer_work SET state='running',attempts=attempts+1,attempt_id=$6,lease_until=clock_timestamp()+interval '30 seconds',updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5`, b.TenantID, b.ConnectorID, b.Source, processor, key, w.AttemptID)
	if err != nil {
		return w, err
	}
	w.Attempts++
	w.State = "running"
	return w, tx.Commit(ctx)
}

func deadTx(ctx context.Context, tx pgx.Tx, b telemetry.Binding, processor, key, messageID, reason string) error {
	_, err := tx.Exec(ctx, `UPDATE stream_consumer_work SET state='dead',lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5`, b.TenantID, b.ConnectorID, b.Source, processor, key)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO stream_dead_letters(tenant_id,connector_id,source,processor,work_key,message_id,reason,attempts) SELECT tenant_id,connector_id,source,processor,work_key,$6,$7,attempts FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5 ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source, processor, key, messageID, reason)
	return err
}

// FenceWork holds the work row until the effects transaction commits. CompleteWork
// checks expiry again after the handler, so a late handler cannot commit effects.
func FenceWork(ctx context.Context, tx pgx.Tx, b telemetry.Binding, processor string, w Work) error {
	var one int
	err := tx.QueryRow(ctx, `SELECT 1 FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5 AND attempt_id::text=$6 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source, processor, w.Key, w.AttemptID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLease
	}
	return err
}

func CompleteWork(ctx context.Context, tx pgx.Tx, b telemetry.Binding, processor string, w Work) error {
	tag, err := tx.Exec(ctx, `UPDATE stream_consumer_work SET state='done',lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5 AND attempt_id::text=$6 AND state='running' AND lease_until>clock_timestamp()`, b.TenantID, b.ConnectorID, b.Source, processor, w.Key, w.AttemptID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrLease
	}
	return nil
}

func (s Store) FinishReplay(ctx context.Context, b telemetry.Binding, processor string, w Work) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = CompleteWork(ctx, tx, b, processor, w); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s Store) FailWork(ctx context.Context, b telemetry.Binding, processor string, w Work, messageID, reason string, permanent bool) (bool, error) {
	if reason != "INVALID_DELIVERY" && reason != "UNKNOWN_EVENT" && reason != "CONTENT_CONFLICT" && reason != "HANDLER_FAILED" {
		return false, ErrInvalid
	}
	if !messagePattern.MatchString(messageID) || len(messageID) > 128 {
		return false, ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if err = FenceWork(ctx, tx, b, processor, w); err != nil {
		return false, err
	}
	var attempts, max int
	if err = tx.QueryRow(ctx, `SELECT attempts,max_attempts FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5`, b.TenantID, b.ConnectorID, b.Source, processor, w.Key).Scan(&attempts, &max); err != nil {
		return false, err
	}
	if permanent || attempts >= max {
		if err = deadTx(ctx, tx, b, processor, w.Key, messageID, reason); err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}
	_, err = tx.Exec(ctx, `UPDATE stream_consumer_work SET state='waiting',lease_until=NULL,available_at=clock_timestamp()+($6::bigint*interval '1 millisecond'),updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5`, b.TenantID, b.ConnectorID, b.Source, processor, w.Key, RetryDelay(attempts).Milliseconds())
	if err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}

// DeferPublication pauses on backpressure without burning the failure budget.
func (s Store) DeferPublication(ctx context.Context, b telemetry.Binding, l Lease) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET state='queued',attempts=attempts-1,lease_until=NULL,available_at=clock_timestamp()+interval '1 second',updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 AND attempt_id::text=$5 AND state='publishing' AND lease_until>clock_timestamp()`, b.TenantID, b.ConnectorID, b.Source, l.EventKey, l.AttemptID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrLease
	}
	return nil
}

// Publications uses keyset pagination so healthy earlier entries cannot starve
// later missing receipts. The processor is the single required sandbox group.
func (s Store) Publications(ctx context.Context, b telemetry.Binding, processor, after string) ([]Publication, error) {
	if !validBinding(b) || !idPattern.MatchString(processor) || (after != "" && !hashPattern.MatchString(after)) {
		return nil, ErrInvalid
	}
	rows, err := s.Pool.Query(ctx, `SELECT o.event_key,o.message_id,e.content_hash FROM stream_outbox o JOIN stream_events e USING(tenant_id,connector_id,source,event_key) WHERE o.tenant_id=$1 AND o.connector_id=$2 AND o.source=$3 AND o.state='published' AND o.event_key>$5
 AND NOT EXISTS(SELECT 1 FROM stream_inbox i WHERE i.tenant_id=o.tenant_id AND i.connector_id=o.connector_id AND i.source=o.source AND i.processor=$4 AND i.event_key=o.event_key)
 AND NOT EXISTS(SELECT 1 FROM stream_consumer_work w WHERE w.tenant_id=o.tenant_id AND w.connector_id=o.connector_id AND w.source=o.source AND w.processor=$4 AND w.work_key='event:'||o.event_key AND w.state='dead')
 ORDER BY o.event_key LIMIT 100`, b.TenantID, b.ConnectorID, b.Source, processor, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Publication
	for rows.Next() {
		var p Publication
		if err := rows.Scan(&p.Key, &p.MessageID, &p.ContentHash); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

func (s Store) CheckAccepted(ctx context.Context, b telemetry.Binding, key, hash string) error {
	if !validBinding(b) || !hashPattern.MatchString(key) || !hashPattern.MatchString(hash) {
		return ErrInvalid
	}
	var stored string
	err := s.Pool.QueryRow(ctx, `SELECT content_hash FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4`, b.TenantID, b.ConnectorID, b.Source, key).Scan(&stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if stored != hash {
		return ErrConflict
	}
	return nil
}

func (s Store) RecordGap(ctx context.Context, b telemetry.Binding, processor, messageID string, limit int64) error {
	return s.gap(ctx, b, processor, messageID, "", limit)
}
func (s Store) ReplayMissing(ctx context.Context, b telemetry.Binding, processor string, p Publication, limit int64) error {
	if !hashPattern.MatchString(p.Key) {
		return ErrInvalid
	}
	return s.gap(ctx, b, processor, p.MessageID, p.Key, limit)
}
func (s Store) gap(ctx context.Context, b telemetry.Binding, processor, messageID, key string, limit int64) error {
	if !messagePattern.MatchString(messageID) || len(messageID) > 128 {
		return ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = lockBudget(ctx, tx, b, processor, limit, "", messageID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO stream_replay_gaps(tenant_id,connector_id,source,processor,message_id,event_key) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')) ON CONFLICT(tenant_id,connector_id,source,processor,message_id) DO UPDATE SET event_key=COALESCE(stream_replay_gaps.event_key,EXCLUDED.event_key)`, b.TenantID, b.ConnectorID, b.Source, processor, messageID, key)
	if err != nil {
		return err
	}
	if key != "" {
		_, err = tx.Exec(ctx, `UPDATE stream_outbox o SET state=CASE WHEN recovery_count>=3 THEN 'failed' ELSE 'queued' END,
 error_code=CASE WHEN recovery_count>=3 THEN 'ATTEMPTS_EXHAUSTED' ELSE NULL END,
 recovery_count=LEAST(recovery_count+1,3),attempts=0,attempt_id=NULL,published_at=NULL,message_id=NULL,available_at=now(),updated_at=now()
 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 AND state='published' AND message_id=$5
 AND NOT EXISTS(SELECT 1 FROM stream_inbox i WHERE i.tenant_id=o.tenant_id AND i.connector_id=o.connector_id AND i.source=o.source AND i.processor=$6 AND i.event_key=o.event_key)`, b.TenantID, b.ConnectorID, b.Source, key, messageID, processor)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s Store) RecoveryStats(ctx context.Context, b telemetry.Binding, processor string) (RecoveryStats, error) {
	var r RecoveryStats
	if !validBinding(b) || !idPattern.MatchString(processor) {
		return r, ErrInvalid
	}
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE state='waiting'),count(*) FILTER(WHERE state='running'),count(*) FILTER(WHERE state='dead'),count(*) FILTER(WHERE state='done') FROM stream_consumer_work WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4`, b.TenantID, b.ConnectorID, b.Source, processor).Scan(&r.Waiting, &r.Running, &r.Dead, &r.Done)
	if err != nil {
		return r, err
	}
	err = s.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM stream_replay_gaps WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4),(SELECT count(*) FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND state='failed')`, b.TenantID, b.ConnectorID, b.Source, processor).Scan(&r.Gaps, &r.PublicationFailed)
	return r, err
}
