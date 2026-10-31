package threatintel

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/threatintel/threatsql"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var linkRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

func validHuntPhrase(s string) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	return n >= 2 && n <= 200 && !strings.ContainsRune(s, 0)
}

type Registry struct {
	Items   []map[string]any `json:"items"`
	Total   int64            `json:"total"`
	Sources int64            `json:"sources"`
}

func (s Store) Registry(ctx context.Context, tenant, search, status string, relevant bool, limit, offset int) (Registry, error) {
	if utf8.RuneCountInString(search) > 200 || limit < 1 || limit > 100 || offset < 0 || offset > 1000000 {
		return Registry{}, invalid()
	}
	switch status {
	case "", "new", "reviewing", "actionable", "archived":
	default:
		return Registry{}, invalid()
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Registry{}, err
	}
	defer tx.Rollback(ctx)
	q := threatsql.New(tx)
	counts, err := q.RegistryCounts(ctx, threatsql.RegistryCountsParams{TenantID: tenant, Column2: search, Column3: relevant, Column4: status})
	if err != nil {
		return Registry{}, err
	}
	rows, err := q.RegistryReports(ctx, threatsql.RegistryReportsParams{TenantID: tenant, Column2: search, Column3: relevant, Column4: status, Limit: int32(limit), Offset: int32(offset)})
	if err != nil {
		return Registry{}, err
	}
	result := Registry{Items: []map[string]any{}, Total: counts.Reports, Sources: counts.Sources}
	for _, raw := range rows {
		var item map[string]any
		if err = json.Unmarshal(raw, &item); err != nil {
			return Registry{}, err
		}
		result.Items = append(result.Items, item)
	}
	return result, tx.Commit(ctx)
}

type HuntLink struct {
	Available      bool   `json:"available"`
	HuntID         string `json:"hunt_id"`
	IndicatorID    string `json:"indicator_id"`
	IndicatorValue string `json:"indicator_value"`
	Actor          string `json:"actor"`
	CreatedAt      string `json:"created_at,omitempty"`
}

func (s Store) Workspace(ctx context.Context, tenant, id string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	report, err := get(ctx, tx, Reports, tenant, id)
	if err != nil {
		return nil, err
	}
	q := threatsql.New(tx)
	count, err := q.ReportIndicatorCount(ctx, threatsql.ReportIndicatorCountParams{TenantID: tenant, ReportID: id})
	if err != nil {
		return nil, err
	}
	rows, err := q.ReportHuntLinks(ctx, threatsql.ReportHuntLinksParams{TenantID: tenant, ReportID: id})
	if err != nil {
		return nil, err
	}
	links := []HuntLink{}
	for _, r := range rows {
		links = append(links, HuntLink{Available: r.Available, HuntID: r.HuntID, IndicatorID: r.IndicatorID, IndicatorValue: r.IndicatorValue, Actor: r.Actor, CreatedAt: investigations.Timestamp(r.CreatedAt.Time)})
	}
	return map[string]any{"report": report, "indicator_count": count, "hunts": links}, tx.Commit(ctx)
}
func (s Store) CreateLocalHunt(ctx context.Context, tenant, reportID, actor, key, indicatorID string) (HuntLink, error) {
	if !linkRequestID.MatchString(key) || indicatorID == "" || len(indicatorID) > 100 {
		return HuntLink{}, invalid()
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return HuntLink{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "threat-intelligence:"+tenant); err != nil {
		return HuntLink{}, err
	}
	report, err := get(ctx, tx, Reports, tenant, reportID)
	if err != nil {
		return HuntLink{}, err
	}
	q := threatsql.New(tx)
	prior, err := q.ReportHuntLink(ctx, threatsql.ReportHuntLinkParams{TenantID: tenant, ReportID: reportID, RequestID: key})
	if err == nil {
		if prior.Actor != actor || prior.IndicatorID != indicatorID {
			return HuntLink{}, fault.New(409, "VERSION_CONFLICT", "Request ID already used for another hunt.")
		}
		if !prior.Available {
			return HuntLink{}, fault.New(410, "HUNT_DELETED", "The hunt created by this request was deleted. Use a new request ID to create another.")
		}
		return HuntLink{Available: true, HuntID: prior.HuntID, IndicatorID: prior.IndicatorID, IndicatorValue: prior.IndicatorValue, Actor: prior.Actor}, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return HuntLink{}, err
	}
	if report["status"] == "archived" {
		return HuntLink{}, fault.New(409, "ARCHIVED", "Restore the report before creating a hunt.")
	}
	indicator, err := get(ctx, tx, Indicators, tenant, indicatorID)
	if err != nil {
		return HuntLink{}, err
	}
	if indicator["report_id"] != reportID {
		return HuntLink{}, fault.New(400, "INVALID_INDICATOR", "Choose an indicator belonging to this report.")
	}
	value, _ := indicator["value"].(string)
	if indicator["status"] != "active" || !validHuntPhrase(value) {
		return HuntLink{}, fault.New(400, "INVALID_INDICATOR", "Choose an active indicator with a value of 2–200 characters.")
	}
	id := "HUNT-" + jobs.ID()
	now := time.Now().UTC().Truncate(time.Millisecond)
	stamp := investigations.Timestamp(now)
	title, _ := report["title"].(string)
	if len([]rune(title)) > 180 {
		title = string([]rune(title)[:180])
	}
	document := map[string]any{"id": id, "tenant_id": tenant, "name": "Hunt: " + title, "query": strings.TrimSpace(value), "source": "threat_report:" + reportID, "status": "draft", "verdict": nil, "findings_count": 0, "last_run_at": nil, "insight_refs": []string{}, "created_at": stamp, "updated_at": stamp}
	raw, err := json.Marshal(document)
	if err != nil {
		return HuntLink{}, err
	}
	if err = q.InsertLinkedHunt(ctx, threatsql.InsertLinkedHuntParams{TenantID: tenant, ID: id, Document: raw, UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true}}); err != nil {
		return HuntLink{}, err
	}
	if err = q.InsertReportHuntLink(ctx, threatsql.InsertReportHuntLinkParams{TenantID: tenant, ReportID: reportID, RequestID: key, HuntID: id, IndicatorID: indicatorID, IndicatorValue: value, Actor: actor}); err != nil {
		return HuntLink{}, err
	}
	for _, event := range []struct{ resource, id string }{{"hunts", id}, {"threat_intel_reports", reportID}} {
		if err = investigations.ResourceAudit(ctx, tx, tenant, event.resource, event.id, "local_hunt_created", map[string]any{"actor": actor, "request_id": key, "report_id": reportID, "hunt_id": id, "indicator_id": indicatorID}); err != nil {
			return HuntLink{}, err
		}
	}
	return HuntLink{Available: true, HuntID: id, IndicatorID: indicatorID, IndicatorValue: value, Actor: actor, CreatedAt: stamp}, tx.Commit(ctx)
}
