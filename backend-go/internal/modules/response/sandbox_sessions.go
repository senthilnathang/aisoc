package response

import (
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"regexp"
)

type SandboxGrant struct {
	Actor   auth.Principal
	Binding telemetry.Binding
}
type SandboxSessionRequest struct {
	Operation       string `json:"operation"`
	ID              string `json:"id"`
	SessionID       string `json:"session_id"`
	PrincipalRef    string `json:"principal_ref"`
	Ticket          string `json:"ticket"`
	ExpectedVersion int64  `json:"expected_version"`
	Stopped         bool   `json:"stopped"`
}

// SandboxSession never invokes a provider. Scope grants come from trusted config;
// approval, revocation, policy and audit commit in the same PostgreSQL transaction.
func (s Store) SandboxSession(ctx context.Context, actor auth.Principal, b telemetry.Binding, grants []SandboxGrant, in SandboxSessionRequest) (map[string]any, error) {
	allowed := false
	for _, g := range grants {
		if g.Actor == actor && g.Binding == b && actor.Tenant == b.TenantID && actor.ID != "" {
			allowed = true
		}
	}
	if !allowed {
		return nil, eventstate.ErrRecoveryDenied
	}
	id := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
	if !id.MatchString(in.Ticket) {
		return nil, eventstate.ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO sandbox_response_policy(tenant_id,connector_id,source) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source); err != nil {
		return nil, err
	}
	var stopped bool
	if err = tx.QueryRow(ctx, `SELECT stopped FROM sandbox_response_policy WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source).Scan(&stopped); err != nil {
		return nil, err
	}
	result := map[string]any{"mode": "sandbox", "external_calls": 0}
	switch in.Operation {
	case "policy":
		_, err = tx.Exec(ctx, `UPDATE sandbox_response_policy SET stopped=$4 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3`, b.TenantID, b.ConnectorID, b.Source, in.Stopped)
		result["stopped"] = in.Stopped
	case "create_session":
		if !id.MatchString(in.SessionID) || !id.MatchString(in.PrincipalRef) {
			return nil, eventstate.ErrInvalid
		}
		var full bool
		if err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM sandbox_sessions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3)>=100 AND NOT EXISTS(SELECT 1 FROM sandbox_sessions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4)`, b.TenantID, b.ConnectorID, b.Source, in.SessionID).Scan(&full); err != nil {
			return nil, err
		}
		if full {
			return nil, eventstate.ErrCapacity
		}
		_, err = tx.Exec(ctx, `INSERT INTO sandbox_sessions(tenant_id,connector_id,source,id,principal_ref) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source, in.SessionID, in.PrincipalRef)
		if err == nil {
			var owner string
			var revoked bool
			var version int64
			err = tx.QueryRow(ctx, `SELECT principal_ref,revoked,version FROM sandbox_sessions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4`, b.TenantID, b.ConnectorID, b.Source, in.SessionID).Scan(&owner, &revoked, &version)
			if err == nil && owner != in.PrincipalRef {
				return nil, eventstate.ErrConflict
			}
			result["revoked"], result["version"] = revoked, version
		}
	case "propose":
		if !id.MatchString(in.ID) || !id.MatchString(in.SessionID) || in.ExpectedVersion < 1 {
			return nil, eventstate.ErrInvalid
		}
		var targetExists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sandbox_sessions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4)`, b.TenantID, b.ConnectorID, b.Source, in.SessionID).Scan(&targetExists); err != nil {
			return nil, err
		}
		if !targetExists {
			return nil, eventstate.ErrNotFound
		}
		var full bool
		if err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM sandbox_session_actions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3)>=100 AND NOT EXISTS(SELECT 1 FROM sandbox_session_actions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4)`, b.TenantID, b.ConnectorID, b.Source, in.ID).Scan(&full); err != nil {
			return nil, err
		}
		if full {
			return nil, eventstate.ErrCapacity
		}
		_, err = tx.Exec(ctx, `INSERT INTO sandbox_session_actions(tenant_id,connector_id,source,id,session_id,expected_version,ticket) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, b.TenantID, b.ConnectorID, b.Source, in.ID, in.SessionID, in.ExpectedVersion, in.Ticket)
		if err == nil {
			var same bool
			var state string
			err = tx.QueryRow(ctx, `SELECT session_id=$5 AND expected_version=$6 AND ticket=$7,state FROM sandbox_session_actions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4`, b.TenantID, b.ConnectorID, b.Source, in.ID, in.SessionID, in.ExpectedVersion, in.Ticket).Scan(&same, &state)
			if err == nil && !same {
				return nil, eventstate.ErrConflict
			}
			result["state"] = state
		}
	case "approve", "execute", "dry_run":
		if !id.MatchString(in.ID) {
			return nil, eventstate.ErrInvalid
		}
		var state, session string
		var expected int64
		var fresh bool
		err = tx.QueryRow(ctx, `SELECT state,session_id,expected_version,COALESCE(approval_expires_at>clock_timestamp(),false) FROM sandbox_session_actions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source, in.ID).Scan(&state, &session, &expected, &fresh)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, eventstate.ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		if state == "executed" {
			result["state"] = "executed"
			result["replayed"] = true
			return result, tx.Commit(ctx)
		}
		var version int64
		var revoked bool
		if err = tx.QueryRow(ctx, `SELECT version,revoked FROM sandbox_sessions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source, session).Scan(&version, &revoked); err != nil {
			return nil, err
		}
		if version != expected || revoked {
			return nil, eventstate.ErrConflict
		}
		switch in.Operation {
		case "approve":
			if state != "proposed" {
				return nil, eventstate.ErrConflict
			}
			_, err = tx.Exec(ctx, `UPDATE sandbox_session_actions SET state='approved',approved_by=$5,approval_expires_at=now()+interval '5 minutes' WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4`, b.TenantID, b.ConnectorID, b.Source, in.ID, actor.ID)
			result["state"] = "approved"
		case "dry_run":
			result["would_execute"] = !stopped && state == "approved" && fresh
			result["stopped"] = stopped
			result["state"] = state
		case "execute":
			if stopped || state != "approved" || !fresh {
				return nil, eventstate.ErrRecoveryDenied
			}
			var recent int
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM sandbox_session_actions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND executed_at>clock_timestamp()-interval '1 minute'`, b.TenantID, b.ConnectorID, b.Source).Scan(&recent); err != nil {
				return nil, err
			}
			if recent >= 10 {
				return nil, eventstate.ErrCapacity
			}
			if _, err = tx.Exec(ctx, `UPDATE sandbox_sessions SET revoked=true,version=version+1 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4`, b.TenantID, b.ConnectorID, b.Source, session); err == nil {
				_, err = tx.Exec(ctx, `UPDATE sandbox_session_actions SET state='executed',executed_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4`, b.TenantID, b.ConnectorID, b.Source, in.ID)
			}
			result["state"] = "executed"
		}
	default:
		return nil, eventstate.ErrInvalid
	}
	if err != nil {
		return nil, err
	}
	details, _ := json.Marshal(map[string]any{"actor": actor.ID, "request": in, "result": result})
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'sandbox_session',$3,$4,$5,now(),now())`, b.TenantID, jobs.ID(), b.ConnectorID+":"+in.ID, "sandbox_"+in.Operation, details); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}
