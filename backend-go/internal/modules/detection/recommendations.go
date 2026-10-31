package detection

import (
	"aisoc/backend/internal/modules/detection/detectionsql"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"strings"
	"time"
)

func stamp(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
func recommendationError(message string) error {
	return fault.New(409, "RECOMMENDATION_GUARD", message)
}
func recommendationSamples(ctx context.Context, q *detectionsql.Queries, tenant, id string, start, end time.Time) ([]RecommendationSample, error) {
	rows, err := q.RecommendationAlerts(ctx, detectionsql.RecommendationAlertsParams{TenantID: tenant, RuleID: id, WindowStart: stamp(start), WindowEnd: stamp(end)})
	if err != nil {
		return nil, err
	}
	sample := []RecommendationSample{}
	for _, row := range rows {
		var fields map[string]string
		if err = json.Unmarshal(row.Document, &fields); err != nil {
			return nil, err
		}
		sample = append(sample, RecommendationSample{ID: row.ID, InvestigationID: fields["investigation_id"], Title: fields["title"], Source: fields["source"], PrimaryEntity: fields["primary_entity"], Severity: fields["severity"], CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339Nano), Label: row.Label, LabelVersion: int(row.LabelVersion), Rationale: row.Rationale, Reviewer: row.Reviewer})
	}
	return sample, nil
}
func (s Store) Recommendations(ctx context.Context, tenant, id string, days int) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rule, version, err := get(ctx, tx, tenant, id, false)
	if err != nil {
		return nil, err
	}
	end := time.Now().UTC()
	start := end.Add(-time.Duration(days) * 24 * time.Hour)
	q := detectionsql.New(tx)
	summary, err := q.RecommendationLabelSummary(ctx, detectionsql.RecommendationLabelSummaryParams{TenantID: tenant, RuleID: id, WindowStart: stamp(start), WindowEnd: stamp(end)})
	if err != nil {
		return nil, err
	}
	sample, err := recommendationSamples(ctx, q, tenant, id, start, end)
	if err != nil {
		return nil, err
	}
	truncated := len(sample) > 500
	if truncated {
		sample = sample[:500]
	}
	raw, err := q.ListRecommendations(ctx, detectionsql.ListRecommendationsParams{TenantID: tenant, RuleID: id})
	if err != nil {
		return nil, err
	}
	var items []map[string]any
	if err = json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	for _, item := range items {
		item["stale_rule"] = item["base_version"] != float64(version)
	}
	reviewed := int(summary.FalsePositives + summary.TruePositives)
	var share any
	if reviewed > 0 {
		share = percent(int(summary.FalsePositives), reviewed)
	}
	result := map[string]any{"items": items, "alerts": sample, "sample_truncated": truncated, "rule_version": version, "rule_enabled": rule["enabled"] == true, "source_severity": rule["severity"], "days": days, "window_start": start, "window_end": end, "statistics": map[string]any{"received": summary.Alerts, "reviewed": reviewed, "false_positives": summary.FalsePositives, "true_positives": summary.TruePositives, "false_positive_share": share, "confidence": "not_calibrated"}, "dialect": recommendationDialect, "provider_sync": "unsupported"}
	return result, tx.Commit(ctx)
}

type AlertLabelInput struct {
	Label           string `json:"label"`
	Rationale       string `json:"rationale"`
	ExpectedVersion int    `json:"expected_version"`
}

func (s Store) LabelAlert(ctx context.Context, tenant, actor, ruleID, alertID string, in AlertLabelInput) (int, error) {
	if actor == "" || !contains([]string{"true_positive", "false_positive", "unreviewed"}, in.Label) || strings.TrimSpace(in.Rationale) == "" || len(in.Rationale) > 2000 || in.ExpectedVersion < 0 || in.ExpectedVersion > 2147483646 {
		return 0, fault.New(400, "VALIDATION_ERROR", "Explicit label, rationale and valid version are required")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, _, err = get(ctx, tx, tenant, ruleID, true); err != nil {
		return 0, err
	}
	v, err := detectionsql.New(tx).SaveRecommendationLabel(ctx, detectionsql.SaveRecommendationLabelParams{TenantID: tenant, RuleID: ruleID, AlertID: alertID, Label: in.Label, Rationale: in.Rationale, Reviewer: actor, ExpectedVersion: int32(in.ExpectedVersion)})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, recommendationError("Alert label changed or alert does not belong to this rule; reload")
	}
	if err != nil {
		return 0, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", ruleID, "alert_labelled", map[string]any{"alert_id": alertID, "label": in.Label, "reviewer": actor, "version": v, "rationale": in.Rationale}); err != nil {
		return 0, err
	}
	return int(v), tx.Commit(ctx)
}
func (s Store) GenerateRecommendations(ctx context.Context, tenant, actor, id string, days, expected int) (int, error) {
	if actor == "" || days < 1 || days > 90 {
		return 0, fault.New(400, "VALIDATION_ERROR", "Invalid recommendation window")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rule, version, err := get(ctx, tx, tenant, id, true)
	if err != nil {
		return 0, err
	}
	if expected != version {
		return 0, recommendationError("Rule changed; reload before generating")
	}
	baseQuery, _ := rule["query"].(string)
	if _, e := parseExclusion(baseQuery); e == nil {
		return 0, recommendationError("Rule already contains a local exclusion; a new provider-supported baseline is required for further tuning")
	}
	end := time.Now().UTC()
	start := end.Add(-time.Duration(days) * 24 * time.Hour)
	q := detectionsql.New(tx)
	sample, err := recommendationSamples(ctx, q, tenant, id, start, end)
	if err != nil {
		return 0, err
	}
	if len(sample) > 500 {
		return 0, recommendationError("Window exceeds the 500-alert replay budget; reduce the time window")
	}
	candidates := suggest(sample)
	if len(candidates) == 0 {
		return 0, recommendationError("No safe exclusion found. Label true and false positives; candidates must preserve all true-positive and unreviewed alerts")
	}
	raw, _ := json.Marshal(sample)
	hash := sampleHash(sample)
	base, _ := rule["query"].(string)
	created := 0
	for _, candidate := range candidates {
		query, _ := json.Marshal(candidate)
		recID := "REC-" + jobs.ID()
		title := "Exclude reviewed noise by " + candidate.Field
		why := fmt.Sprintf("Exact %s exclusion removes %d labelled false positives and preserves every labelled true positive and unreviewed alert in this frozen sample. Review scope before local application.", candidate.Field, replay(candidate, sample).FalsePositivesRemoved)
		n, err := q.InsertRecommendation(ctx, detectionsql.InsertRecommendationParams{TenantID: tenant, ID: recID, RuleID: id, BaseVersion: int32(version), BaseQuery: base, ProposedQuery: string(query), Title: title, Rationale: why, Sample: raw, SampleHash: hash, WindowStart: stamp(start), WindowEnd: stamp(end), CreatedBy: actor})
		if err != nil {
			return 0, err
		}
		if n > 0 {
			created++
			if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", id, "recommendation_created", map[string]any{"recommendation_id": recID, "base_version": version, "actor": actor, "sample_hash": hash, "sample_size": len(sample), "generator": "deterministic-local-v1"}); err != nil {
				return 0, err
			}
		}
	}
	return created, tx.Commit(ctx)
}
func (s Store) RecommendationAction(ctx context.Context, tenant, actor, ruleID, id, action string) (map[string]any, error) {
	if actor == "" || !contains([]string{"validate", "test", "apply", "dismiss"}, action) {
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid recommendation action")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rule, version, err := get(ctx, tx, tenant, ruleID, true)
	if err != nil {
		return nil, err
	}
	q := detectionsql.New(tx)
	rec, err := q.LockRecommendation(ctx, detectionsql.LockRecommendationParams{TenantID: tenant, RuleID: ruleID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing()
	}
	if err != nil {
		return nil, err
	}
	if rec.Status == "applied" && action == "apply" || rec.Status == "dismissed" && action == "dismiss" {
		return map[string]any{"status": rec.Status, "idempotent": true}, tx.Commit(ctx)
	}
	if rec.Status != "pending" {
		return nil, recommendationError("Recommendation is no longer pending")
	}
	details := map[string]any{"recommendation_id": id, "actor": actor, "base_version": rec.BaseVersion, "sample_hash": rec.SampleHash}
	result := map[string]any{"status": "pending"}
	if action == "dismiss" {
		err = q.SetRecommendationStatus(ctx, detectionsql.SetRecommendationStatusParams{TenantID: tenant, ID: id, Status: "dismissed"})
		result["status"] = "dismissed"
	} else {
		if int(rec.BaseVersion) != version {
			return nil, recommendationError("Rule version changed; generate a new recommendation")
		}
		predicate, parseErr := parseExclusion(rec.ProposedQuery)
		if parseErr != nil {
			return nil, fault.New(400, "UNSUPPORTED_DIALECT", parseErr.Error())
		}
		validation, _ := json.Marshal(map[string]any{"valid": true, "dialect": recommendationDialect, "scope": "Local exclusion syntax only; no provider validation"})
		if action == "validate" {
			err = q.UpdateRecommendationReceipt(ctx, detectionsql.UpdateRecommendationReceiptParams{TenantID: tenant, ID: id, Validation: validation, TestResult: rec.TestResult, TestedAt: rec.TestedAt})
			result["valid"] = true
		} else {
			current, e := recommendationSamples(ctx, q, tenant, ruleID, rec.WindowStart.Time, rec.WindowEnd.Time)
			if e != nil {
				return nil, e
			}
			if sampleHash(current) != rec.SampleHash {
				return nil, recommendationError("Evidence or labels changed; generate a new recommendation")
			}
			report := replay(predicate, current)
			testJSON, _ := json.Marshal(report)
			if action == "test" {
				err = q.UpdateRecommendationReceipt(ctx, detectionsql.UpdateRecommendationReceiptParams{TenantID: tenant, ID: id, Validation: validation, TestResult: testJSON, TestedAt: stamp(time.Now().UTC())})
				result["test_result"] = report
			} else {
				var prior ReplayResult
				if json.Unmarshal(rec.TestResult, &prior) != nil || !prior.Passed || !rec.TestedAt.Valid || time.Since(rec.TestedAt.Time) > 24*time.Hour || prior.SampleHash != rec.SampleHash || !report.Passed {
					return nil, recommendationError("Apply requires a passing replay receipt less than 24 hours old")
				}
				if rule["enabled"] == true {
					return nil, recommendationError("Disable the rule and regenerate against its new version before applying locally")
				}
				bindings, e := ruleBindings(ctx, tx, tenant, ruleID)
				if e != nil {
					return nil, e
				}
				if len(bindings) > 0 {
					return nil, recommendationError("Provider-bound rules require a provider validator; local apply is disabled")
				}
				rule["query"] = rec.ProposedQuery
				rule["enabled"] = false
				rule["updated_at"] = investigations.Timestamp(time.Now().UTC())
				raw, _ := json.Marshal(rule)
				if err = q.ApplyRecommendationRule(ctx, detectionsql.ApplyRecommendationRuleParams{TenantID: tenant, ID: ruleID, Document: raw, Version: int32(version + 1)}); err != nil {
					return nil, err
				}
				if err = snapshot(ctx, tx, tenant, ruleID, version+1, rule); err != nil {
					return nil, err
				}
				err = q.SetRecommendationStatus(ctx, detectionsql.SetRecommendationStatusParams{TenantID: tenant, ID: id, Status: "applied"})
				result["status"] = "applied"
				result["rule_version"] = version + 1
				details["rule_version"] = version + 1
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", ruleID, "recommendation_"+action, details); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}
