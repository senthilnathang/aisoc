package response

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"unicode/utf8"
)

type StepState struct {
	Completed bool    `json:"completed"`
	Note      string  `json:"note"`
	UpdatedBy *string `json:"updated_by"`
	UpdatedAt *string `json:"updated_at"`
}
type Assignment struct {
	ID              string      `json:"id"`
	InvestigationID string      `json:"investigation_id"`
	PlanID          string      `json:"plan_id"`
	Snapshot        Plan        `json:"snapshot"`
	Version         int         `json:"version"`
	Steps           []StepState `json:"steps"`
	CreatedAt       string      `json:"created_at"`
}
type AssignmentView struct {
	Assignment
	History []map[string]any `json:"history"`
}
type StepInput struct {
	ExpectedVersion   int
	StepIndex         int
	Completed         bool
	Note              string
	ApprovalConfirmed bool
}

func caseEvent(ctx context.Context, tx pgx.Tx, tenant string, a Assignment, actor, action string, details map[string]any) error {
	event := map[string]any{"action": action, "actor": actor, "created_at": stamp(), "version": a.Version}
	audit := map[string]any{"record_id": a.ID, "actor": actor}
	for key, value := range details {
		event[key] = value
		audit[key] = value
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO case_runbook_events(tenant_id,assignment_id,version,document) VALUES($1,$2,$3,$4)`, tenant, a.ID, a.Version, raw); err != nil {
		return err
	}
	return investigations.Audit(ctx, tx, tenant, a.InvestigationID, action, audit)
}
func (s Store) Assignments(ctx context.Context, tenant, caseID string) ([]AssignmentView, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err = investigations.Exists(ctx, tx, tenant, caseID); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT r.document,(SELECT coalesce(jsonb_agg(e.document ORDER BY e.version DESC),'[]'::jsonb) FROM case_runbook_events e WHERE e.tenant_id=r.tenant_id AND e.assignment_id=r.id) FROM case_runbooks r WHERE r.tenant_id=$1 AND r.investigation_id=$2 ORDER BY r.ordinal DESC`, tenant, caseID)
	if err != nil {
		return nil, err
	}
	items := []AssignmentView{}
	for rows.Next() {
		var item AssignmentView
		var raw, events []byte
		if err = rows.Scan(&raw, &events); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(raw, &item.Assignment); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(events, &item.History); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return items, tx.Commit(ctx)
}
func (s Store) Attach(ctx context.Context, tenant, caseID, planID string, version int, actor string) (Assignment, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback(ctx)
	if err = investigations.Lock(ctx, tx, tenant, caseID); err != nil {
		return Assignment{}, err
	}
	plan, err := get(ctx, tx, tenant, planID, true)
	if err != nil {
		return Assignment{}, err
	}
	if plan.Version != version {
		return Assignment{}, conflict()
	}
	if plan.Kind != "runbook" || plan.State != "active" {
		return Assignment{}, fault.New(400, "INVALID_RUNBOOK", "Choose an active runbook.")
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM case_runbooks WHERE tenant_id=$1 AND investigation_id=$2 AND plan_id=$3)`, tenant, caseID, planID).Scan(&exists); err != nil {
		return Assignment{}, err
	}
	if exists {
		return Assignment{}, fault.New(409, "ALREADY_ATTACHED", "This runbook is already attached to the case.")
	}
	a := Assignment{ID: jobs.ID(), InvestigationID: caseID, PlanID: planID, Snapshot: plan, Version: 1, Steps: make([]StepState, len(plan.Steps)), CreatedAt: stamp()}
	raw, err := json.Marshal(a)
	if err != nil {
		return Assignment{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO case_runbooks(tenant_id,id,investigation_id,plan_id,document) VALUES($1,$2,$3,$4,$5)`, tenant, a.ID, caseID, planID, raw); err != nil {
		return Assignment{}, err
	}
	if err = caseEvent(ctx, tx, tenant, a, actor, "runbook_attached", map[string]any{"title": plan.Title, "plan_version": plan.Version}); err != nil {
		return Assignment{}, err
	}
	return a, tx.Commit(ctx)
}
func (s Store) Step(ctx context.Context, tenant, caseID, id string, in StepInput, actor string) (Assignment, error) {
	if in.ExpectedVersion < 1 || in.StepIndex < 0 || in.StepIndex > 49 || utf8.RuneCountInString(in.Note) > 4000 {
		return Assignment{}, fault.New(400, "VALIDATION_ERROR", "Invalid runbook step update.")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback(ctx)
	if err = investigations.Lock(ctx, tx, tenant, caseID); err != nil {
		return Assignment{}, err
	}
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT document FROM case_runbooks WHERE tenant_id=$1 AND investigation_id=$2 AND id=$3 FOR UPDATE`, tenant, caseID, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Assignment{}, fault.New(404, "NOT_FOUND", "Attached runbook not found")
	}
	if err != nil {
		return Assignment{}, err
	}
	var a Assignment
	if err = json.Unmarshal(raw, &a); err != nil {
		return Assignment{}, err
	}
	if a.Version != in.ExpectedVersion {
		return Assignment{}, conflict()
	}
	if in.StepIndex >= len(a.Snapshot.Steps) {
		return Assignment{}, fault.New(400, "INVALID_STEP", "Runbook step not found")
	}
	step := a.Snapshot.Steps[in.StepIndex]
	if in.Completed && step.ApprovalRequired && !in.ApprovalConfirmed {
		return Assignment{}, fault.New(400, "APPROVAL_REQUIRED", "Confirm analyst approval for this step.")
	}
	now := stamp()
	a.Steps[in.StepIndex] = StepState{in.Completed, in.Note, &actor, &now}
	a.Version++
	raw, err = json.Marshal(a)
	if err != nil {
		return Assignment{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE case_runbooks SET document=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, raw); err != nil {
		return Assignment{}, err
	}
	action := "runbook_step_updated"
	if in.Completed {
		action = "runbook_step_completed"
	}
	if err = caseEvent(ctx, tx, tenant, a, actor, action, map[string]any{"step_index": in.StepIndex, "title": step.Title, "note": in.Note, "approval_confirmed": in.Completed && step.ApprovalRequired && in.ApprovalConfirmed}); err != nil {
		return Assignment{}, err
	}
	return a, tx.Commit(ctx)
}
