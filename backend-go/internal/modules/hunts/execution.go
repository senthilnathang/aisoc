package hunts

import (
	"aisoc/backend/internal/modules/hunts/huntsql"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/jobs/jobsql"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"strings"
)

const HuntPlugin = "go.hunt_search"

func uuid(v string) pgtype.UUID     { var id pgtype.UUID; _ = id.Scan(v); return id }
func conflict(message string) error { return fault.New(409, "EXECUTION_CONFLICT", message) }

type Execution struct {
	ID          string `json:"id"`
	JobID       string `json:"job_id"`
	Query       string `json:"query"`
	Expected    string `json:"expected_updated_at"`
	Actor       string `json:"actor"`
	State       string `json:"state"`
	Phase       string `json:"phase"`
	Attempts    int32  `json:"attempts"`
	MaxAttempts int32  `json:"max_attempts"`
	ErrorCode   string `json:"error_code,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	AvailableAt string `json:"available_at"`
}

func execution(row huntsql.HuntExecutionRow) Execution {
	phase := row.Phase
	if row.State != "running" {
		phase = row.State
	}
	return Execution{row.RunID, row.EJobID, row.Query, row.ExpectedUpdatedAt, row.Actor, row.State, phase, row.Attempts, row.MaxAttempts, row.ErrorCode.String, investigations.Timestamp(row.CreatedAt.Time), investigations.Timestamp(row.UpdatedAt.Time), investigations.Timestamp(row.AvailableAt.Time)}
}
func (s Store) Queue(ctx context.Context, tenant, id, actor, key, expected string) (Execution, error) {
	if !requestID.MatchString(key) || expected == "" {
		return Execution{}, fault.New(400, "VALIDATION_ERROR", "A request ID and expected_updated_at are required.")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Execution{}, err
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	if err = q.LockHuntTenant(ctx, tenant); err != nil {
		return Execution{}, err
	}
	h, err := locked(ctx, q, tenant, id)
	if err != nil {
		return Execution{}, err
	}
	old, err := q.HuntExecution(ctx, huntsql.HuntExecutionParams{TenantID: tenant, HuntID: id, RunID: key})
	if err == nil {
		if old.Actor != actor || old.ExpectedUpdatedAt != expected {
			return Execution{}, conflict("Request ID already belongs to another request.")
		}
		return execution(old), tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Execution{}, err
	}
	if _, err = q.HuntRun(ctx, huntsql.HuntRunParams{TenantID: tenant, HuntID: id, ID: key}); err == nil {
		return Execution{}, conflict("Request ID already belongs to a synchronous search.")
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Execution{}, err
	}
	if h["updated_at"] != expected {
		return Execution{}, conflict("This hunt changed. Reload before queueing it.")
	}
	query, _ := h["query"].(string)
	query = strings.TrimSpace(query)
	if err = validateSearch(key, query); err != nil {
		return Execution{}, err
	}
	count, err := q.HuntExecutionCount(ctx, huntsql.HuntExecutionCountParams{TenantID: tenant, HuntID: id})
	if err != nil {
		return Execution{}, err
	}
	if count >= 100 {
		return Execution{}, conflict("This hunt reached its 100-run retention limit.")
	}
	if err = executionCapacity(ctx, q, tenant, id); err != nil {
		return Execution{}, err
	}
	job := jobs.ID()
	if err = jobs.Enqueue(ctx, tx, tenant, job, HuntPlugin, []byte(`{}`)); err != nil {
		return Execution{}, err
	}
	if err = q.InsertHuntExecution(ctx, huntsql.InsertHuntExecutionParams{TenantID: tenant, HuntID: id, RunID: key, JobID: uuid(job), Query: query, ExpectedUpdatedAt: expected, Actor: actor}); err != nil {
		return Execution{}, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "hunts", id, "search_queued", map[string]any{"actor": actor, "run_id": key, "job_id": job}); err != nil {
		return Execution{}, err
	}
	row, err := q.HuntExecution(ctx, huntsql.HuntExecutionParams{TenantID: tenant, HuntID: id, RunID: key})
	if err != nil {
		return Execution{}, err
	}
	return execution(row), tx.Commit(ctx)
}
func executionCapacity(ctx context.Context, q *huntsql.Queries, tenant, id string) error {
	for _, scope := range []string{id, ""} {
		n, err := q.ActiveHuntExecutions(ctx, huntsql.ActiveHuntExecutionsParams{TenantID: tenant, Column2: scope})
		if err != nil {
			return err
		}
		limit := int64(1)
		if scope == "" {
			limit = 100
		}
		if n >= limit {
			return conflict("Hunt execution capacity reached; wait for completion or cancel pending work.")
		}
	}
	return nil
}
func (s Store) ControlExecution(ctx context.Context, tenant, id, actor, key, operation string, attempts int32) (Execution, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Execution{}, err
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	if err = q.LockHuntTenant(ctx, tenant); err != nil {
		return Execution{}, err
	}
	if _, err = locked(ctx, q, tenant, id); err != nil {
		return Execution{}, err
	}
	row, err := q.HuntExecution(ctx, huntsql.HuntExecutionParams{TenantID: tenant, HuntID: id, RunID: key})
	if errors.Is(err, pgx.ErrNoRows) {
		return Execution{}, missing()
	}
	if err != nil {
		return Execution{}, err
	}
	// Locking the job after the hunt serializes cancellation against receipt publication.
	j, err := q.LockHuntJob(ctx, huntsql.LockHuntJobParams{TenantID: tenant, ID: uuid(row.EJobID)})
	if err != nil {
		return Execution{}, err
	}
	switch operation {
	case "cancel":
		if j.State == "cancelled" {
			return execution(row), tx.Commit(ctx)
		}
		if j.State != "queued" && j.State != "running" {
			return Execution{}, conflict("Only queued or running searches can be cancelled.")
		}
		n, e := jobsql.New(tx).Cancel(ctx, jobsql.CancelParams{TenantID: tenant, ID: row.EJobID})
		if e != nil {
			return Execution{}, e
		}
		if n != 1 {
			return Execution{}, jobs.ErrStale
		}
	case "retry":
		// Repeating the same extension request cannot replenish the budget twice.
		if (attempts == 3 || attempts == 6) && j.MaxAttempts == attempts+3 && j.Attempts >= attempts {
			return execution(row), tx.Commit(ctx)
		}
		if j.State != "failed" || j.Attempts != attempts || j.MaxAttempts >= 9 {
			return Execution{}, conflict("Retry requires the current failed attempt and a remaining retry budget.")
		}
		if err = executionCapacity(ctx, q, tenant, id); err != nil {
			return Execution{}, err
		}
		n, e := q.RetryHuntExecution(ctx, huntsql.RetryHuntExecutionParams{TenantID: tenant, ID: uuid(row.EJobID), Attempts: attempts})
		if e != nil {
			return Execution{}, e
		}
		if n != 1 {
			return Execution{}, jobs.ErrStale
		}
	default:
		return Execution{}, fault.New(400, "VALIDATION_ERROR", "Unknown execution operation.")
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "hunts", id, "search_"+operation, map[string]any{"actor": actor, "run_id": key, "attempts": attempts}); err != nil {
		return Execution{}, err
	}
	row, err = q.HuntExecution(ctx, huntsql.HuntExecutionParams{TenantID: tenant, HuntID: id, RunID: key})
	if err != nil {
		return Execution{}, err
	}
	return execution(row), tx.Commit(ctx)
}

// reserveQueuedID prevents synchronous clients from bypassing job cancellation.
func reserveQueuedID(ctx context.Context, q *huntsql.Queries, tenant, id, key string) error {
	_, err := q.HuntExecution(ctx, huntsql.HuntExecutionParams{TenantID: tenant, HuntID: id, RunID: key})
	if err == nil {
		return conflict("This request ID is reserved for queued execution. Inspect its job status.")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
