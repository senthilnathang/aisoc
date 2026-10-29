package detection

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"reflect"
	"time"
	"unicode/utf16"
)

type Store struct{ Pool *pgxpool.Pool }

var Fields = []string{"name", "description", "mitre_techniques", "execution_mode", "enabled", "severity", "query", "schedule", "lookback_window", "routing"}

type Queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func missing() error { return fault.New(404, "NOT_FOUND", "detection_rules not found") }
func get(ctx context.Context, db Queryer, tenant, id string, lock bool) (map[string]any, int, error) {
	query := `SELECT document,version FROM detection_rules WHERE tenant_id=$1 AND id=$2`
	if lock {
		query += " FOR UPDATE"
	}
	var record map[string]any
	var version int
	err := db.QueryRow(ctx, query, tenant, id).Scan(&record, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing()
	}
	return record, version, err
}
func snapshot(ctx context.Context, tx pgx.Tx, tenant, id string, version int, record map[string]any) error {
	values := map[string]any{}
	for _, key := range Fields {
		values[key] = record[key]
	}
	raw, err := json.Marshal(values)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO detection_rule_versions(tenant_id,rule_id,version,snapshot,created_at) VALUES($1,$2,$3,$4,$5)`, tenant, id, version, raw, time.Now().UTC().Truncate(time.Millisecond))
	return err
}
func (s Store) create(ctx context.Context, tx pgx.Tx, tenant, id, action string, input map[string]any, details map[string]any) (map[string]any, error) {
	record := map[string]any{"description": "", "mitre_techniques": []any{}, "execution_mode": "scheduled", "enabled": true, "detections": 0, "investigations": 0, "false_positive_rate": 0, "recommendation_status": "not_analyzed", "last_activity_at": nil, "query": "", "schedule": "Every 5 minutes", "lookback_window": "15 minutes", "routing": "Investigate"}
	for _, key := range Fields {
		if v, ok := input[key]; ok {
			record[key] = v
		}
	}
	if record["name"] == nil || record["severity"] == nil {
		return nil, fault.New(400, "VALIDATION_ERROR", "Missing rule fields.")
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	record["id"] = id
	record["tenant_id"] = tenant
	record["created_at"] = investigations.Timestamp(now)
	record["updated_at"] = investigations.Timestamp(now)
	if _, err := tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,$2,$3,$4)`, tenant, id, raw, now); err != nil {
		return nil, err
	}
	if err = snapshot(ctx, tx, tenant, id, 1, record); err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", id, action, details); err != nil {
		return nil, err
	}
	return record, nil
}
func (s Store) Create(ctx context.Context, tenant string, input map[string]any) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	record, err := s.create(ctx, tx, tenant, "RULE-"+jobs.ID()[:8], "created", input, nil)
	if err != nil {
		return nil, err
	}
	return record, tx.Commit(ctx)
}
func (s Store) Clone(ctx context.Context, tenant, id string) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	original, _, err := get(ctx, tx, tenant, id, true)
	if err != nil {
		return nil, err
	}
	// Node truncates clone names by UTF-16 units, before appending the suffix.
	name := utf16.Encode([]rune(original["name"].(string)))
	if len(name) > 193 {
		name = name[:193]
	}
	original["name"] = string(utf16.Decode(name)) + " (copy)"
	original["enabled"] = false
	record, err := s.create(ctx, tx, tenant, "RULE-"+jobs.ID(), "cloned", original, map[string]any{"source_rule_id": id})
	if err != nil {
		return nil, err
	}
	return record, tx.Commit(ctx)
}
func (s Store) Update(ctx context.Context, tenant, id string, input map[string]any, keys []string, expected int, toggle bool) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	record, version, err := get(ctx, tx, tenant, id, true)
	if err != nil {
		return nil, err
	}
	if expected > 0 && expected != version {
		return nil, fault.New(409, "VERSION_CONFLICT", "This rule changed. Reload it before saving.")
	}
	if toggle {
		input = map[string]any{"enabled": !record["enabled"].(bool)}
		keys = []string{"enabled"}
	}
	changed, touched := false, false
	for _, key := range Fields {
		if value, ok := input[key]; ok {
			changed = changed || !reflect.DeepEqual(value, record[key])
			touched = true
			record[key] = value
		}
	}
	if changed {
		version++
	}
	if touched {
		now := time.Now().UTC().Truncate(time.Millisecond)
		record["updated_at"] = investigations.Timestamp(now)
		raw, err := json.Marshal(record)
		if err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `UPDATE detection_rules SET document=$3,version=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2`, tenant, id, raw, version, now); err != nil {
			return nil, err
		}
	}
	if changed {
		if err = snapshot(ctx, tx, tenant, id, version, record); err != nil {
			return nil, err
		}
	}
	if keys == nil {
		keys = []string{}
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", id, "updated", map[string]any{"fields": keys}); err != nil {
		return nil, err
	}
	return record, tx.Commit(ctx)
}
func (s Store) List(ctx context.Context, tenant, search, severity string, limit, offset int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT document FROM detection_rules WHERE tenant_id=$1 AND ($2='' OR document->>'severity'=$2) AND ($3='' OR document->>'name' ILIKE $4 ESCAPE '' OR document->>'description' ILIKE $4 ESCAPE '') ORDER BY updated_at DESC,ordinal LIMIT $5 OFFSET $6`, tenant, severity, search, "%"+search+"%", limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var record map[string]any
		if err = rows.Scan(&record); err != nil {
			return nil, err
		}
		items = append(items, record)
	}
	return items, rows.Err()
}
func (s Store) Detail(ctx context.Context, tenant, id string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	record, version, err := get(ctx, tx, tenant, id, false)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT version,snapshot,created_at FROM detection_rule_versions WHERE tenant_id=$1 AND rule_id=$2 ORDER BY version DESC`, tenant, id)
	if err != nil {
		return nil, err
	}
	versions := []map[string]any{}
	for rows.Next() {
		var n int
		var saved map[string]any
		var created time.Time
		if err = rows.Scan(&n, &saved, &created); err != nil {
			rows.Close()
			return nil, err
		}
		versions = append(versions, map[string]any{"version": n, "snapshot": saved, "created_at": investigations.Timestamp(created)})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	history, err := investigations.ResourceHistory(ctx, tx, tenant, "detection_rules", id)
	if err != nil {
		return nil, err
	}
	record["version"] = version
	record["versions"] = versions
	record["history"] = history
	if err = ruleMetrics(ctx, tx, tenant, []map[string]any{record}); err != nil {
		return nil, err
	}
	bindings, err := ruleBindings(ctx, tx, tenant, id)
	if err != nil {
		return nil, err
	}
	record["bindings"] = bindings
	return record, tx.Commit(ctx)
}
func (s Store) History(ctx context.Context, tenant, id string) ([]investigations.Event, error) {
	if _, _, err := get(ctx, s.Pool, tenant, id, false); err != nil {
		return nil, err
	}
	return investigations.ResourceHistory(ctx, s.Pool, tenant, "detection_rules", id)
}
func (s Store) Delete(ctx context.Context, tenant, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, _, err = get(ctx, tx, tenant, id, true); err != nil {
		return err
	}
	var referenced bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM api_sources WHERE tenant_id=$1 AND rule_id=$2)`, tenant, id).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		return fault.New(409, "SOURCE_REFERENCE_EXISTS", "An API source references this rule. Disable the rule instead.")
	}
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM alerts WHERE tenant_id=$1 AND rule_id=$2)`, tenant, id).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		return fault.New(409, "ALERT_REFERENCE_EXISTS", "This record is retained by ingested alerts. Close the case or disable the rule instead.")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM detection_rules WHERE tenant_id=$1 AND id=$2`, tenant, id); err != nil {
		return err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", id, "deleted", nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
