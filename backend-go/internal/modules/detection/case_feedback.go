package detection

import (
	"aisoc/backend/internal/modules/detection/detectionsql"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type CaseAlertLabelInput struct {
	Label           string `json:"label"`
	Rationale       string `json:"rationale"`
	ExpectedVersion *int   `json:"expected_version"`
	Confirm         bool   `json:"confirm"`
}

func (s Store) CaseFeedback(ctx context.Context, tenant, id string, limit, offset int) (map[string]any, error) {
	if limit < 1 || limit > 100 || offset < 0 || offset > 1000000 {
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid feedback pagination.")
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := detectionsql.New(tx)
	c, e := q.FeedbackCase(ctx, detectionsql.FeedbackCaseParams{TenantID: tenant, ID: id})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Investigation not found.")
	}
	if e != nil {
		return nil, e
	}
	total, e := q.FeedbackAlertCount(ctx, detectionsql.FeedbackAlertCountParams{TenantID: tenant, InvestigationID: pgtype.Text{String: id, Valid: true}})
	if e != nil {
		return nil, e
	}
	rows, e := q.FeedbackAlerts(ctx, detectionsql.FeedbackAlertsParams{TenantID: tenant, InvestigationID: pgtype.Text{String: id, Valid: true}, PageLimit: int32(limit), PageOffset: int32(offset)})
	if e != nil {
		return nil, e
	}
	items := []json.RawMessage{}
	for _, r := range rows {
		items = append(items, r)
	}
	return map[string]any{"case": map[string]any{"id": c.ID, "title": c.Title, "status": c.Status, "determination": c.Determination}, "items": items, "total": total, "limit": limit, "offset": offset}, tx.Commit(ctx)
}
func (s Store) LabelCaseAlert(ctx context.Context, tenant, actor, caseID, alertID string, in CaseAlertLabelInput) (map[string]any, error) {
	if !in.Confirm || in.ExpectedVersion == nil {
		return nil, fault.New(400, "VALIDATION_ERROR", "Explicit confirmation and the current label version are required.")
	}
	label := AlertLabelInput{Label: in.Label, Rationale: in.Rationale, ExpectedVersion: *in.ExpectedVersion}
	if e := validateAlertLabel(actor, label); e != nil {
		return nil, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := detectionsql.New(tx)
	ruleID, e := q.FeedbackAlertRule(ctx, detectionsql.FeedbackAlertRuleParams{TenantID: tenant, InvestigationID: pgtype.Text{String: caseID, Valid: true}, ID: alertID})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Source alert not found in this investigation.")
	}
	if e != nil {
		return nil, e
	}
	// Match the recommendation engine's lock order: rule first, then source alert.
	if _, _, e = get(ctx, tx, tenant, ruleID, true); e != nil {
		return nil, e
	}
	current, e := q.LockFeedbackAlert(ctx, detectionsql.LockFeedbackAlertParams{TenantID: tenant, InvestigationID: pgtype.Text{String: caseID, Valid: true}, ID: alertID})
	if errors.Is(e, pgx.ErrNoRows) || e == nil && current != ruleID {
		return nil, recommendationError("Source alert changed. Refresh before reviewing.")
	}
	if e != nil {
		return nil, e
	}
	version, e := labelAlertTx(ctx, tx, tenant, actor, ruleID, alertID, label)
	if e != nil {
		return nil, e
	}
	if e = investigations.ResourceAudit(ctx, tx, tenant, "investigations", caseID, "source_alert_labelled", map[string]any{"actor": actor, "alert_id": alertID, "rule_id": ruleID, "label": in.Label, "rationale": in.Rationale, "version": version}); e != nil {
		return nil, e
	}
	return map[string]any{"version": version, "rule_id": ruleID, "alert_id": alertID}, tx.Commit(ctx)
}
