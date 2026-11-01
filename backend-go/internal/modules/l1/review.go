package l1

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/fault"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
	"time"
)

// Review is an operator projection, never an action authorization or raw payload dump.
type Review struct {
	ReviewRequired bool                    `json:"review_required"`
	ReviewedBy     string                  `json:"reviewed_by,omitempty"`
	ReviewComment  string                  `json:"review_comment,omitempty"`
	ReviewedAt     *time.Time              `json:"reviewed_at,omitempty"`
	ReviewScope    string                  `json:"review_scope,omitempty"`
	ConnectorID    string                  `json:"-"`
	Source         string                  `json:"-"`
	State          string                  `json:"state"`
	JobID          string                  `json:"job_id,omitempty"`
	Mode           string                  `json:"mode,omitempty"`
	Attempts       int                     `json:"attempts"`
	MaxAttempts    int                     `json:"max_attempts"`
	ErrorCode      string                  `json:"error_code,omitempty"`
	UpdatedAt      time.Time               `json:"updated_at,omitempty"`
	SyncState      string                  `json:"sync_state,omitempty"`
	ResultStatus   string                  `json:"result_status"`
	Evidence       []*pb.EvidenceItem      `json:"evidence"`
	Result         *pb.InvestigationResult `json:"result,omitempty"`
}

func CaseReview(ctx context.Context, pool *pgxpool.Pool, tenant, incident string) (Review, error) {
	v := Review{State: "not_requested", ResultStatus: "not_available", Evidence: []*pb.EvidenceItem{}}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return v, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM investigations WHERE tenant_id=$1 AND id=$2)`, tenant, incident).Scan(&exists); err != nil {
		return v, err
	}
	if !exists {
		return v, fault.New(404, "NOT_FOUND", "Investigation not found.")
	}
	b := telemetry.Binding{TenantID: tenant}
	var finding string
	err = tx.QueryRow(ctx, `SELECT connector_id,source,finding_id FROM stream_findings WHERE tenant_id=$1 AND investigation_id=$2`, tenant, incident).Scan(&b.ConnectorID, &b.Source, &finding)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, tx.Commit(ctx)
	}
	if err != nil {
		return v, err
	}
	v.ConnectorID = b.ConnectorID
	v.Source = b.Source
	v.JobID = mockJobID(b, finding)
	v.State = "awaiting_dispatch"
	var input, output []byte
	var attempt string
	err = tx.QueryRow(ctx, `SELECT j.state,j.input,j.output,coalesce(j.attempt_id::text,''),j.attempts,j.max_attempts,coalesce(j.error_code,''),j.updated_at,coalesce(e.state,'not_started'),coalesce(e.review_required,false),coalesce(e.reviewed_by,''),coalesce(e.review_comment,''),e.reviewed_at FROM jobs j LEFT JOIN l1_escalations e ON e.tenant_id=j.tenant_id AND e.job_id=j.id AND e.investigation_id=$3 WHERE j.tenant_id=$1 AND j.id=$2 AND j.plugin_id=$4 AND j.plugin_version='1'`, tenant, v.JobID, incident, Plugin).Scan(&v.State, &input, &output, &attempt, &v.Attempts, &v.MaxAttempts, &v.ErrorCode, &v.UpdatedAt, &v.SyncState, &v.ReviewRequired, &v.ReviewedBy, &v.ReviewComment, &v.ReviewedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, tx.Commit(ctx)
	}
	if err != nil {
		return v, err
	}
	if v.ReviewRequired && v.ReviewedBy == "" && v.SyncState == "draft" {
		v.SyncState = "awaiting_review"
	}
	var task pb.InvestigationTask
	if proto.Unmarshal(input, &task) != nil || task.TenantId != tenant || task.IncidentId != incident || task.TaskId != v.JobID || task.AttemptId != "" || task.DeadlineUnixMs != 0 {
		v.ResultStatus = "invalid"
		return v, tx.Commit(ctx)
	}
	task.AttemptId = attempt
	if task.AttemptId == "" {
		task.AttemptId = "pending"
	}
	task.DeadlineUnixMs = v.UpdatedAt.Add(time.Second).UnixMilli()
	if ValidateTask(&task, v.UpdatedAt) != nil {
		v.ResultStatus = "invalid"
		return v, tx.Commit(ctx)
	}
	v.Mode = task.Mode
	v.Evidence = task.Evidence
	if v.State == "completed" {
		var result pb.InvestigationResult
		if proto.Unmarshal(output, &result) != nil || VerifyResult(&task, &result, v.UpdatedAt) != nil {
			v.ResultStatus = "invalid"
		} else {
			v.ResultStatus = "verified"
			v.Result = &result
		}
	}
	return v, tx.Commit(ctx)
}
