package eventstate

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"github.com/jackc/pgx/v5"
)

type ConsumerRetry struct {
	PublicationRetry
	Processor string `json:"processor"`
}

// RetryConsumer only retries accepted event work after a handler failure or
// exhausted attempts. Poison deliveries and content conflicts cannot be reset.
// The old DLQ entry is preserved in the audit before opening a new bounded cycle.
func (o OperatorRecovery) RetryConsumer(ctx context.Context, actor auth.Principal, b telemetry.Binding, req ConsumerRetry) (bool, error) {
	allowed := false
	for _, g := range o.Grants {
		if g.Operator == actor && g.Binding == b && actor.ID != "" && actor.Tenant == b.TenantID {
			allowed = true
		}
	}
	if !allowed {
		return false, ErrRecoveryDenied
	}
	if req.ExpectedRecoveryCount != 0 {
		return false, ErrInvalid
	}
	if !validBinding(b) || !idPattern.MatchString(req.Processor) || !idPattern.MatchString(actor.ID) || !idPattern.MatchString(req.RequestID) || !idPattern.MatchString(req.Ticket) || !hashPattern.MatchString(req.EventKey) || len(req.ExpectedAttemptID) > 36 || req.ExpectedAttempts < 1 || req.ExpectedAttempts > 10 || req.ExpectedOperatorRetries < 0 || req.ExpectedOperatorRetries > 3 || (req.Reason != "transport_restored" && req.Reason != "configuration_corrected") {
		return false, ErrInvalid
	}
	request, _ := json.Marshal(struct {
		Actor   string
		Binding telemetry.Binding
		Request ConsumerRetry
	}{actor.ID, b, req})
	resource, _ := json.Marshal([]string{b.TenantID, b.ConnectorID, b.Source, req.Processor, req.EventKey})
	id := fmt.Sprintf("stream-consumer-retry:%x", sha256.Sum256([]byte(req.RequestID)))
	resourceID := fmt.Sprintf("%x", sha256.Sum256(resource))
	tx, err := o.Store.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var one int
	if err = tx.QueryRow(ctx, `SELECT 1 FROM stream_source_checkpoints WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 FOR NO KEY UPDATE`, b.TenantID, b.ConnectorID, b.Source).Scan(&one); err != nil {
		return false, err
	}
	if err = lockMetadata(ctx, tx, b, req.Processor); err != nil {
		return false, err
	}
	var publication string
	if err = tx.QueryRow(ctx, `SELECT state FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source, req.EventKey).Scan(&publication); errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	} else if err != nil {
		return false, err
	}
	var same bool
	err = tx.QueryRow(ctx, `SELECT resource='stream_consumer' AND resource_id=$3 AND action='stream_consumer_retry' AND details->'request'=$4::jsonb FROM audit_events WHERE tenant_id=$1 AND id=$2`, b.TenantID, id, resourceID, request).Scan(&same)
	if err == nil {
		if !same {
			return false, ErrConflict
		}
		return true, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	var state, attempt, reason string
	var attempts, retries int
	err = tx.QueryRow(ctx, `SELECT w.state,COALESCE(w.attempt_id::text,''),w.attempts,d.reason FROM stream_consumer_work w JOIN stream_dead_letters d USING(tenant_id,connector_id,source,processor,work_key) WHERE w.tenant_id=$1 AND w.connector_id=$2 AND w.source=$3 AND w.processor=$4 AND w.work_key=$5 FOR UPDATE OF w`, b.TenantID, b.ConnectorID, b.Source, req.Processor, "event:"+req.EventKey).Scan(&state, &attempt, &attempts, &reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='stream_consumer' AND resource_id=$2 AND action='stream_consumer_retry'`, b.TenantID, resourceID).Scan(&retries); err != nil {
		return false, err
	}
	if state != "dead" || publication == "publishing" || attempt != req.ExpectedAttemptID || attempts != req.ExpectedAttempts || retries != req.ExpectedOperatorRetries || (reason != "HANDLER_FAILED" && reason != "ATTEMPTS_EXHAUSTED") {
		return false, ErrConflict
	}
	if retries >= 3 {
		return false, ErrCapacity
	}
	var done bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_inbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND event_key=$5)`, b.TenantID, b.ConnectorID, b.Source, req.Processor, req.EventKey).Scan(&done); err != nil {
		return false, err
	}
	if done {
		return false, ErrConflict
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) SELECT $1,$2,'stream_consumer',$3,'stream_consumer_retry',jsonb_build_object('request',$4::jsonb,'previous_dead_letter',to_jsonb(d)),now(),now() FROM stream_dead_letters d WHERE tenant_id=$1 AND connector_id=$5 AND source=$6 AND processor=$7 AND work_key=$8`, b.TenantID, id, resourceID, request, b.ConnectorID, b.Source, req.Processor, "event:"+req.EventKey); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM stream_dead_letters WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5`, b.TenantID, b.ConnectorID, b.Source, req.Processor, "event:"+req.EventKey); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE stream_consumer_work SET state='waiting',attempts=0,attempt_id=NULL,lease_until=NULL,available_at=now(),updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5`, b.TenantID, b.ConnectorID, b.Source, req.Processor, "event:"+req.EventKey); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE stream_outbox SET state='queued',attempts=0,attempt_id=NULL,lease_until=NULL,available_at=now(),published_at=NULL,message_id=NULL,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4`, b.TenantID, b.ConnectorID, b.Source, req.EventKey); err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}
