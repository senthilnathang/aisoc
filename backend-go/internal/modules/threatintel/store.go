package threatintel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/legacy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ Pool *pgxpool.Pool }
type Kind bool

const Reports Kind = false
const Indicators Kind = true

func (k Kind) table() string {
	if k == Indicators {
		return "threat_indicators"
	}
	return "threat_intel_reports"
}
func missing(k Kind) error { return fault.New(404, "NOT_FOUND", k.table()+" not found") }
func invalid() error {
	return fault.New(400, "VALIDATION_ERROR", "Invalid threat intelligence fields.")
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// Only private, constant table/column names are interpolated into SQL.
func projection(k Kind) string {
	dates := []string{"created_at", "updated_at"}
	if k == Reports {
		dates = append(dates, "published_at")
	} else {
		dates = append(dates, "last_seen_at")
	}
	parts := []string{}
	for _, key := range dates {
		parts = append(parts, fmt.Sprintf("'%s',to_char(t.%s AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')", key, key))
	}
	return "(to_jsonb(t)-'ordinal') || jsonb_build_object(" + strings.Join(parts, ",") + ")"
}
func get(ctx context.Context, db queryer, k Kind, tenant, id string) (map[string]any, error) {
	var item map[string]any
	err := db.QueryRow(ctx, "SELECT "+projection(k)+" FROM "+k.table()+" t WHERE tenant_id=$1 AND id=$2", tenant, id).Scan(&item)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing(k)
	}
	return item, err
}

type Options struct {
	Search, Status, Severity, ReportID string
	Limit, Offset                      int
}

func list(ctx context.Context, db queryer, k Kind, tenant string, o Options) ([]map[string]any, error) {
	search := "(t.title ILIKE $5 ESCAPE '' OR t.summary ILIKE $5 ESCAPE '' OR t.source ILIKE $5 ESCAPE '')"
	parent := ""
	args := []any{tenant, o.Status, o.Severity, o.Search, "%" + o.Search + "%", o.Limit, o.Offset}
	if k == Indicators {
		search = "(t.value ILIKE $5 ESCAPE '' OR t.indicator_type ILIKE $5 ESCAPE '')"
		parent = " AND ($8='' OR t.report_id=$8)"
		args = append(args, o.ReportID)
	}
	rows, err := db.Query(ctx, "SELECT "+projection(k)+" FROM "+k.table()+" t WHERE tenant_id=$1 AND ($2='' OR status=$2) AND ($3='' OR severity=$3) AND ($4='' OR "+search+")"+parent+" ORDER BY updated_at DESC,ordinal DESC LIMIT $6 OFFSET $7", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var item map[string]any
		if err = rows.Scan(&item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s Store) List(ctx context.Context, k Kind, tenant string, o Options) ([]map[string]any, error) {
	return list(ctx, s.Pool, k, tenant, o)
}
func (s Store) Detail(ctx context.Context, k Kind, tenant, id string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	item, err := get(ctx, tx, k, tenant, id)
	if err != nil {
		return nil, err
	}
	if k == Reports {
		item["indicators"], err = list(ctx, tx, Indicators, tenant, Options{ReportID: id, Limit: 100})
		if err != nil {
			return nil, err
		}
	}
	return item, tx.Commit(ctx)
}

func fields(k Kind, raw map[string]json.RawMessage) ([]string, []any, error) {
	names := []string{"title", "summary", "source", "report_type", "severity", "status", "ioc_count", "hunt_status", "hunts_launched", "findings_count", "tags", "published_at"}
	enums := map[string]string{"report_type": "threat_report advisory ioc_feed hunt_pack", "severity": "low medium high critical", "status": "new reviewing actionable archived", "hunt_status": "not_started hunting completed no_findings"}
	if k == Indicators {
		names = []string{"report_id", "indicator_type", "value", "severity", "status", "hits", "last_seen_at"}
		enums = map[string]string{"indicator_type": "ip domain hash_sha256 hash_md5 url email cve", "status": "active mitigated expired false_positive"}
	}
	cols := []string{}
	values := []any{}
	for _, name := range names {
		v, ok := raw[name]
		if !ok {
			continue
		}
		var value any
		var err error
		switch name {
		case "ioc_count", "hunts_launched", "findings_count", "hits":
			value, err = legacy.Integer(v)
		case "tags":
			if !json.Valid(v) {
				return nil, nil, invalid()
			}
			value = v
		case "published_at", "last_seen_at":
			if name == "last_seen_at" && string(v) == "null" {
				value = nil
			} else {
				var text string
				text, err = legacy.Text(v)
				if err == nil {
					value, err = time.Parse(time.RFC3339Nano, text)
				}
			}
		default:
			value, err = legacy.Text(v)
		}
		if err != nil {
			return nil, nil, invalid()
		}
		if choices, ok := enums[name]; ok {
			valid := false
			for _, choice := range strings.Fields(choices) {
				if value == choice {
					valid = true
				}
			}
			if !valid {
				return nil, nil, invalid()
			}
		}
		cols = append(cols, name)
		values = append(values, value)
	}
	return cols, values, nil
}

// A tenant-scoped transaction lock gives report deletes, indicator reassignment,
// and counter increments one lock order. Workers only read these reference tables.
func (s Store) Mutate(ctx context.Context, k Kind, tenant, id, operation string, raw map[string]json.RawMessage, keys []string) (map[string]any, error) {
	cols, values, err := fields(k, raw)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "threat-intelligence:"+tenant); err != nil {
		return nil, err
	}
	action := "updated"
	var details = map[string]any{"fields": keys}
	now := time.Now().UTC().Truncate(time.Millisecond)
	if operation != "create" {
		if _, err = get(ctx, tx, k, tenant, id); err != nil {
			return nil, err
		}
	}
	if k == Indicators {
		for i, col := range cols {
			if col == "report_id" {
				if _, err = get(ctx, tx, Reports, tenant, values[i].(string)); err != nil {
					return nil, err
				}
			}
		}
	}
	switch operation {
	case "create":
		if _, err = tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant); err != nil {
			return nil, err
		}
		prefix := "TIR-"
		if k == Indicators {
			prefix = "IOC-"
		}
		id = prefix + jobs.ID()[:8]
		if k == Reports {
			if _, ok := raw["published_at"]; !ok {
				cols = append(cols, "published_at")
				values = append(values, now)
			}
		}
		cols = append(cols, "tenant_id", "id", "created_at", "updated_at")
		values = append(values, tenant, id, now, now)
		params := []string{}
		for i := range values {
			params = append(params, fmt.Sprintf("$%d", i+1))
		}
		_, err = tx.Exec(ctx, "INSERT INTO "+k.table()+" ("+strings.Join(cols, ",")+") VALUES ("+strings.Join(params, ",")+")", values...)
		action = "created"
		details = nil
	case "delete":
		_, err = tx.Exec(ctx, "DELETE FROM "+k.table()+" WHERE tenant_id=$1 AND id=$2", tenant, id)
		action = "deleted"
		details = nil
	case "launch":
		if k != Reports {
			return nil, invalid()
		}
		_, err = tx.Exec(ctx, `UPDATE threat_intel_reports SET hunt_status='hunting',hunts_launched=hunts_launched+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, now)
		details = map[string]any{"fields": []string{"hunt_status", "hunts_launched"}}
	case "patch":
		auditKeys := []string{}
		for _, key := range keys {
			if key != "secret" {
				auditKeys = append(auditKeys, key)
			}
		}
		details = map[string]any{"fields": auditKeys}
		if len(cols) > 0 {
			cols = append(cols, "updated_at")
			values = append(values, now)
			sets := []string{}
			for i, col := range cols {
				sets = append(sets, fmt.Sprintf("%s=$%d", col, i+1))
			}
			values = append(values, tenant, id)
			_, err = tx.Exec(ctx, fmt.Sprintf("UPDATE %s SET %s WHERE tenant_id=$%d AND id=$%d", k.table(), strings.Join(sets, ","), len(values)-1, len(values)), values...)
		}
	default:
		return nil, invalid()
	}
	if err != nil {
		return nil, err
	}
	// Audit and mutation (including cascades) must succeed together.
	if err = investigations.ResourceAudit(ctx, tx, tenant, k.table(), id, action, details); err != nil {
		return nil, err
	}
	var item map[string]any
	if operation != "delete" {
		item, err = get(ctx, tx, k, tenant, id)
		if err != nil {
			return nil, err
		}
	}
	return item, tx.Commit(ctx)
}

func (s Store) Dashboard(ctx context.Context, tenant string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	reports, err := list(ctx, tx, Reports, tenant, Options{Limit: 500})
	if err != nil {
		return nil, err
	}
	indicators, err := list(ctx, tx, Indicators, tenant, Options{Limit: 500})
	if err != nil {
		return nil, err
	}
	bySource := map[string]int{}
	hunts, hits := 0, 0
	findings := float64(0)
	for _, r := range reports {
		bySource[r["source"].(string)]++
		if r["hunt_status"] == "hunting" {
			hunts++
		}
		findings += r["findings_count"].(float64)
	}
	for _, i := range indicators {
		if i["hits"].(float64) > 0 {
			hits++
		}
	}
	recent := reports
	if len(recent) > 5 {
		recent = recent[:5]
	}
	result := map[string]any{"totalReports": len(reports), "totalIndicators": len(indicators), "indicatorsWithHits": hits, "activeHunts": hunts, "findingsTotal": findings, "reportsBySource": bySource, "recentReports": recent}
	return result, tx.Commit(ctx)
}
