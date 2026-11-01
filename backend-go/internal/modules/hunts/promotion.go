package hunts

import (
	"aisoc/backend/internal/modules/hunts/huntsql"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
	"unicode/utf8"
)

type PromoteInput struct {
	RunID    string `json:"run_id"`
	RecordID string `json:"record_id"`
	Kind     string `json:"kind"`
	Comment  string `json:"comment"`
	Confirm  bool   `json:"confirm"`
}
type Promotion struct {
	MemoryPolicy    string           `json:"memory_policy"`
	Memory          []map[string]any `json:"memory"`
	MemoryTruncated bool             `json:"memory_truncated"`
	InvestigationID string           `json:"investigation_id"`
	HuntID          string           `json:"hunt_id"`
	RunID           string           `json:"run_id"`
	Query           string           `json:"query"`
	Actor           string           `json:"actor"`
	Comment         string           `json:"comment"`
	CreatedAt       string           `json:"created_at"`
	Finding         Finding          `json:"finding"`
	ReportID        string           `json:"report_id,omitempty"`
	IndicatorID     string           `json:"indicator_id,omitempty"`
	IndicatorValue  string           `json:"indicator_value,omitempty"`
	Available       bool             `json:"available"`
}

func validatePromotion(in PromoteInput) error {
	if !in.Confirm || !requestID.MatchString(in.RunID) || in.RecordID == "" || len(in.RecordID) > 200 || (in.Kind != "case" && in.Kind != "artifact") || utf8.RuneCountInString(strings.TrimSpace(in.Comment)) < 10 || utf8.RuneCountInString(in.Comment) > 2000 || strings.ContainsRune(in.Comment, 0) {
		return fault.New(400, "INVALID_PROMOTION", "Confirm a stored finding and provide a review comment of 10–2000 characters.")
	}
	return nil
}
func (s Store) Promote(ctx context.Context, tenant, id, actor string, in PromoteInput) (Promotion, error) {
	if e := validatePromotion(in); e != nil {
		return Promotion{}, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Promotion{}, e
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	if _, e = locked(ctx, q, tenant, id); e != nil {
		return Promotion{}, e
	}
	prior, e := q.HuntPromotion(ctx, huntsql.HuntPromotionParams{TenantID: tenant, HuntID: id, RunID: in.RunID, FindingKind: in.Kind, RecordID: in.RecordID})
	if e == nil {
		var p Promotion
		if e = json.Unmarshal(prior.Document, &p); e != nil {
			return p, e
		}
		if !prior.Available {
			return p, fault.New(410, "CASE_DELETED", "The promoted investigation was deleted; replay does not recreate it.")
		}
		return p, tx.Commit(ctx)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Promotion{}, e
	}
	raw, e := q.HuntRun(ctx, huntsql.HuntRunParams{TenantID: tenant, HuntID: id, ID: in.RunID})
	if errors.Is(e, pgx.ErrNoRows) {
		return Promotion{}, fault.New(404, "RUN_NOT_FOUND", "Stored hunt run not found.")
	}
	if e != nil {
		return Promotion{}, e
	}
	var run Run
	if e = json.Unmarshal(raw, &run); e != nil {
		return Promotion{}, e
	}
	var finding *Finding
	for _, f := range run.Findings {
		if f.RecordID == in.RecordID && f.Kind == in.Kind {
			copy := f
			finding = &copy
			break
		}
	}
	if finding == nil {
		return Promotion{}, fault.New(400, "FINDING_NOT_FOUND", "Select evidence actually recorded in this hunt run.")
	}
	n, e := q.HuntPromotionCount(ctx, huntsql.HuntPromotionCountParams{TenantID: tenant, HuntID: id})
	if e != nil {
		return Promotion{}, e
	}
	if n >= 100 {
		return Promotion{}, fault.New(409, "LIMIT_REACHED", "This hunt reached its 100-promotion local limit.")
	}
	title := "Hunt finding: " + finding.Label
	if len([]rune(title)) > 200 {
		title = string([]rune(title)[:200])
	}
	record, e := investigations.CreateTx(ctx, tx, tenant, investigations.Input{Title: title, Summary: "Analyst-promoted local hunt match. This is not a confirmed threat.\n" + finding.Excerpt, Source: "local-hunt:" + id, Category: "threat-hunt", Severity: "medium", Status: "open", Determination: "unknown", PrimaryEntity: finding.Entity, InsightRefs: []string{}})
	if e != nil {
		return Promotion{}, e
	}
	p := Promotion{MemoryPolicy: run.MemoryPolicy, Memory: run.Memory, MemoryTruncated: run.MemoryTruncated, InvestigationID: record.ID, HuntID: id, RunID: run.ID, Query: run.Query, Actor: actor, Comment: strings.TrimSpace(in.Comment), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Finding: *finding, Available: true}
	links, e := q.HuntSourceIntel(ctx, huntsql.HuntSourceIntelParams{TenantID: tenant, HuntID: id})
	if e != nil {
		return p, e
	}
	if len(links) > 0 {
		p.ReportID = links[0].ReportID
		p.IndicatorID = links[0].IndicatorID
		p.IndicatorValue = links[0].IndicatorValue
	}
	document, _ := json.Marshal(p)
	if e = q.InsertHuntPromotion(ctx, huntsql.InsertHuntPromotionParams{TenantID: tenant, HuntID: id, RunID: run.ID, FindingKind: in.Kind, RecordID: in.RecordID, InvestigationID: record.ID, Document: document}); e != nil {
		return p, e
	}
	artifactID := "ART-" + jobs.ID()
	artifact, _ := json.Marshal(map[string]any{"id": artifactID, "type": "hunt_finding", "label": "Reviewed hunt evidence snapshot", "value": finding.Excerpt, "provenance": p})
	if e = q.InsertPromotedArtifact(ctx, huntsql.InsertPromotedArtifactParams{TenantID: tenant, ID: artifactID, InvestigationID: record.ID, Document: artifact}); e != nil {
		return p, e
	}
	for _, target := range []struct{ resource, id string }{{"hunts", id}, {"investigations", record.ID}} {
		if e = investigations.ResourceAudit(ctx, tx, tenant, target.resource, target.id, "hunt_finding_promoted", map[string]any{"actor": actor, "hunt_id": id, "run_id": run.ID, "source_record_id": in.RecordID, "investigation_id": record.ID, "comment": p.Comment}); e != nil {
			return p, e
		}
	}
	return p, tx.Commit(ctx)
}
func (s Store) CaseOrigin(ctx context.Context, tenant, id string) ([]json.RawMessage, error) {
	if e := investigations.Exists(ctx, s.Pool, tenant, id); e != nil {
		return nil, e
	}
	rows, e := huntsql.New(s.Pool).CaseHuntOrigin(ctx, huntsql.CaseHuntOriginParams{TenantID: tenant, InvestigationID: id})
	out := []json.RawMessage{}
	for _, row := range rows {
		out = append(out, row)
	}
	return out, e
}
