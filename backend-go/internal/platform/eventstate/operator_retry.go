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

var ErrRecoveryDenied = errors.New("stream recovery not authorized")

// RecoveryGrant is trusted service configuration, never a request field.
type RecoveryGrant struct {
	Operator auth.Principal
	Binding  telemetry.Binding
}

// OperatorRecovery is internal and disabled with an empty grant list. A future
// transport must supply its authenticated principal, not an envelope actor.
type OperatorRecovery struct {
	Store  Store
	Grants []RecoveryGrant
}

type PublicationRetry struct {
	RequestID               string `json:"request_id"`
	EventKey                string `json:"event_key"`
	ExpectedAttemptID       string `json:"expected_attempt_id"`
	ExpectedAttempts        int    `json:"expected_attempts"`
	ExpectedRecoveryCount   int    `json:"expected_recovery_count"`
	ExpectedOperatorRetries int    `json:"expected_operator_retries"`
	Reason                  string `json:"reason"`
	Ticket                  string `json:"ticket"`
}

// RetryPublication requeues one failed publication, never consumer poison/DLQ
// work or completed dispositions. At most three operator retries are permitted
// per source event. It returns true only for an identical already-committed request.
// Audit failure rolls back the state change; retained evidence and cursors survive.
func (o OperatorRecovery) RetryPublication(ctx context.Context, actor auth.Principal, b telemetry.Binding, req PublicationRetry) (bool, error) {
	allowed := false
	for _, grant := range o.Grants {
		if grant.Operator == actor && grant.Binding == b && actor.ID != "" && actor.Tenant == b.TenantID {
			allowed = true
		}
	}
	if !allowed {
		return false, ErrRecoveryDenied
	}
	if !validBinding(b) || !idPattern.MatchString(actor.ID) || !idPattern.MatchString(req.RequestID) || !idPattern.MatchString(req.Ticket) || !hashPattern.MatchString(req.EventKey) || len(req.ExpectedAttemptID) > 36 || req.ExpectedAttempts < 0 || req.ExpectedAttempts > 20 || req.ExpectedRecoveryCount < 0 || req.ExpectedRecoveryCount > 3 || req.ExpectedOperatorRetries < 0 || req.ExpectedOperatorRetries > 3 || (req.Reason != "transport_restored" && req.Reason != "configuration_corrected") {
		return false, ErrInvalid
	}
	details, err := json.Marshal(struct {
		Actor     string           `json:"actor"`
		Connector string           `json:"connector_id"`
		Source    string           `json:"source"`
		Request   PublicationRetry `json:"request"`
	}{actor.ID, b.ConnectorID, b.Source, req})
	if err != nil {
		return false, err
	}
	resourceRaw, _ := json.Marshal([]string{b.TenantID, b.ConnectorID, b.Source, req.EventKey})
	resourceID := fmt.Sprintf("%x", sha256.Sum256(resourceRaw))
	auditID := fmt.Sprintf("stream-retry:%x", sha256.Sum256([]byte(req.RequestID)))
	tx, err := o.Store.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var state, attempt string
	var attempts, recovery int
	err = tx.QueryRow(ctx, `SELECT state,COALESCE(attempt_id::text,''),attempts,recovery_count FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source, req.EventKey).Scan(&state, &attempt, &attempts, &recovery)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	var same bool
	err = tx.QueryRow(ctx, `SELECT resource='stream_publication' AND resource_id=$3 AND action='stream_publication_retry' AND details=$4::jsonb FROM audit_events WHERE tenant_id=$1 AND id=$2`, b.TenantID, auditID, resourceID, details).Scan(&same)
	if err == nil {
		if !same {
			return false, ErrConflict
		}
		return true, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	var retries int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='stream_publication' AND resource_id=$2 AND action='stream_publication_retry'`, b.TenantID, resourceID).Scan(&retries)
	if err != nil {
		return false, err
	}
	if state != "failed" || attempt != req.ExpectedAttemptID || attempts != req.ExpectedAttempts || recovery != req.ExpectedRecoveryCount || retries != req.ExpectedOperatorRetries {
		return false, ErrConflict
	}
	if retries >= 3 {
		return false, ErrCapacity
	}
	var completed bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_inbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4)`, b.TenantID, b.ConnectorID, b.Source, req.EventKey).Scan(&completed)
	if err != nil {
		return false, err
	}
	if completed {
		return false, ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'stream_publication',$3,'stream_publication_retry',$4,now(),now())`, b.TenantID, auditID, resourceID, details)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE stream_outbox SET state='queued',attempts=0,attempt_id=NULL,lease_until=NULL,available_at=now(),published_at=NULL,message_id=NULL,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4`, b.TenantID, b.ConnectorID, b.Source, req.EventKey)
	if err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}
