package response

import (
	"aisoc/backend/internal/modules/response/responsesql"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
	"unicode/utf8"
)

type Policy struct {
	Version     int    `json:"version"`
	PlanVersion int    `json:"plan_version"`
	Enabled     bool   `json:"enabled"`
	Connector   string `json:"connector"`
	Calling     string `json:"calling"`
	Severity    string `json:"severity"`
	Source      string `json:"source"`
	UpdatedBy   string `json:"updated_by"`
	UpdatedAt   string `json:"updated_at"`
}

func (p Policy) Validate() error {
	if p.Connector != "local-sandbox" || (p.Calling != "confirmation" && p.Calling != "automatic_dry_run") || utf8.RuneCountInString(p.Source) > 200 {
		return fault.New(400, "VALIDATION_ERROR", "Only local sandbox policies with confirmation or automatic dry-run calling are supported.")
	}
	switch p.Severity {
	case "", "critical", "high", "medium", "low", "info":
	default:
		return fault.New(400, "VALIDATION_ERROR", "Invalid severity condition.")
	}
	return nil
}
func defaultPolicy() Policy { return Policy{Connector: "local-sandbox", Calling: "confirmation"} }
func readPolicy(ctx context.Context, q *responsesql.Queries, tenant, id string) (Policy, error) {
	raw, err := q.WorkflowPolicy(ctx, responsesql.WorkflowPolicyParams{TenantID: tenant, PlanID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultPolicy(), nil
	}
	if err != nil {
		return Policy{}, err
	}
	var p Policy
	err = json.Unmarshal(raw, &p)
	return p, err
}
func (s Store) Policy(ctx context.Context, tenant, id string) (Policy, error) {
	p, err := s.Get(ctx, tenant, id)
	if err != nil {
		return Policy{}, err
	}
	if p.Kind != "workflow" {
		return Policy{}, missing()
	}
	return readPolicy(ctx, responsesql.New(s.Pool), tenant, id)
}
func (s Store) SavePolicy(ctx context.Context, tenant, id, actor string, expected, planVersion int, in Policy) (Policy, error) {
	if err := in.Validate(); err != nil {
		return Policy{}, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Policy{}, err
	}
	defer tx.Rollback(ctx)
	plan, err := get(ctx, tx, tenant, id, true)
	if err != nil {
		return Policy{}, err
	}
	if plan.Kind != "workflow" {
		return Policy{}, missing()
	}
	if plan.State != "active" {
		return Policy{}, fault.New(409, "ARCHIVED", "Restore this workflow before configuring its policy.")
	}
	if plan.Version != planVersion {
		return Policy{}, conflict()
	}
	q := responsesql.New(tx)
	old, err := readPolicy(ctx, q, tenant, id)
	if err != nil {
		return Policy{}, err
	}
	if old.Version != expected {
		return Policy{}, conflict()
	}
	in.Version = old.Version + 1
	in.PlanVersion = plan.Version
	in.UpdatedBy = actor
	in.UpdatedAt = stamp()
	in.Source = strings.TrimSpace(in.Source)
	raw, err := json.Marshal(in)
	if err != nil {
		return Policy{}, err
	}
	if err = q.SaveWorkflowPolicy(ctx, responsesql.SaveWorkflowPolicyParams{TenantID: tenant, PlanID: id, Version: int32(in.Version), Document: raw}); err != nil {
		return Policy{}, err
	}
	if err = q.AuditWorkflowPolicy(ctx, responsesql.AuditWorkflowPolicyParams{TenantID: tenant, PlanID: id, Version: int32(in.Version), Actor: actor, Document: raw}); err != nil {
		return Policy{}, err
	}
	return in, tx.Commit(ctx)
}

type PreviewStep struct {
	Title   string `json:"title"`
	Outcome string `json:"outcome"`
}
type Preview struct {
	ID            string        `json:"id"`
	PlanVersion   int           `json:"plan_version"`
	PolicyVersion int           `json:"policy_version"`
	CaseID        string        `json:"case_id"`
	CaseTitle     string        `json:"case_title"`
	Actor         string        `json:"actor"`
	CreatedAt     string        `json:"created_at"`
	Eligible      bool          `json:"eligible"`
	Reason        string        `json:"reason"`
	Steps         []PreviewStep `json:"steps"`
	DryRun        bool          `json:"dry_run"`
}

func evaluatePreview(plan Plan, p Policy, severity, source string) Preview {
	r := Preview{PlanVersion: plan.Version, PolicyVersion: p.Version, DryRun: true, Steps: []PreviewStep{}, Eligible: true, Reason: "Policy matches. This preview performs no actions."}
	switch {
	case plan.State != "active":
		r.Eligible = false
		r.Reason = "Workflow is archived."
	case !p.Enabled:
		r.Eligible = false
		r.Reason = "Workflow policy is disabled."
	case p.PlanVersion != plan.Version:
		r.Eligible = false
		r.Reason = "Policy is stale. Review and save it against the current workflow version."
	case p.Severity != "" && p.Severity != severity:
		r.Eligible = false
		r.Reason = "Severity condition does not match."
	case p.Source != "" && p.Source != source:
		r.Eligible = false
		r.Reason = "Source condition does not match."
	}
	for _, step := range plan.Steps {
		outcome := "would_run"
		if !r.Eligible {
			outcome = "blocked"
		} else if p.Calling == "confirmation" || step.ApprovalRequired {
			outcome = "approval_required"
		}
		r.Steps = append(r.Steps, PreviewStep{Title: step.Title, Outcome: outcome})
	}
	return r
}
func (s Store) Preview(ctx context.Context, tenant, id, actor, caseID string, expected int) (Preview, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Preview{}, err
	}
	defer tx.Rollback(ctx)
	plan, err := get(ctx, tx, tenant, id, true)
	if err != nil {
		return Preview{}, err
	}
	if plan.Kind != "workflow" {
		return Preview{}, missing()
	}
	if plan.Version != expected {
		return Preview{}, conflict()
	}
	q := responsesql.New(tx)
	c, err := q.WorkflowPreviewCase(ctx, responsesql.WorkflowPreviewCaseParams{TenantID: tenant, ID: caseID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Preview{}, fault.New(404, "NOT_FOUND", "Case not found")
	}
	if err != nil {
		return Preview{}, err
	}
	p, err := readPolicy(ctx, q, tenant, id)
	if err != nil {
		return Preview{}, err
	}
	r := evaluatePreview(plan, p, c.Severity, c.Source)
	r.ID = jobs.ID()
	r.CaseID = c.ID
	r.CaseTitle = c.Title
	r.Actor = actor
	r.CreatedAt = stamp()
	raw, err := json.Marshal(r)
	if err != nil {
		return Preview{}, err
	}
	err = q.InsertWorkflowPreview(ctx, responsesql.InsertWorkflowPreviewParams{TenantID: tenant, PlanID: id, ID: r.ID, Actor: actor, Document: raw})
	if err != nil {
		return Preview{}, err
	}
	return r, tx.Commit(ctx)
}
func (s Store) Previews(ctx context.Context, tenant, id string) ([]Preview, error) {
	if _, err := s.Policy(ctx, tenant, id); err != nil {
		return nil, err
	}
	rows, err := responsesql.New(s.Pool).WorkflowPreviews(ctx, responsesql.WorkflowPreviewsParams{TenantID: tenant, PlanID: id})
	if err != nil {
		return nil, err
	}
	result := []Preview{}
	for _, raw := range rows {
		var p Preview
		if err = json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}

type PolicyItem struct {
	PlanID string `json:"plan_id"`
	Policy Policy `json:"policy"`
}

func (s Store) Policies(ctx context.Context, tenant string) ([]PolicyItem, error) {
	rows, err := responsesql.New(s.Pool).WorkflowPolicies(ctx, tenant)
	if err != nil {
		return nil, err
	}
	result := []PolicyItem{}
	for _, row := range rows {
		var p Policy
		if err = json.Unmarshal(row.Document, &p); err != nil {
			return nil, err
		}
		result = append(result, PolicyItem{PlanID: row.PlanID, Policy: p})
	}
	return result, nil
}
