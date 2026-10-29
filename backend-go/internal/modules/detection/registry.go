package detection

import (
	"context"
	"github.com/jackc/pgx/v5"
	"time"
)

type RegistryOptions struct {
	Search, Severity, Enabled, Source, Sort, Direction string
	Limit, Offset                                      int
}

// Registry combines authored rules, source bindings and persisted alert metrics.
func (s Store) Registry(ctx context.Context, tenant string, options RegistryOptions) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// SQLite's built-in lower/NOCASE fold ASCII only. Explicit translation and C
	// collation keep literal search and tie ordering independent of server locale.
	fold := func(expr string) string {
		return "translate(" + expr + ",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
	}
	where := `tenant_id=$1 AND ($2='' OR strpos(` + fold("document->>'name'") + `,` + fold("$2") + `)>0 OR strpos(` + fold("id") + `,` + fold("$2") + `)>0 OR strpos(` + fold("document->>'description'") + `,` + fold("$2") + `)>0) AND ($3='' OR document->>'severity'=$3) AND ($4='' OR document->>'enabled'=$4) AND ($5='' OR EXISTS(SELECT 1 FROM api_sources s WHERE s.tenant_id=detection_rules.tenant_id AND s.rule_id=detection_rules.id AND s.provider=$5) OR EXISTS(SELECT 1 FROM alerts a WHERE a.tenant_id=detection_rules.tenant_id AND a.rule_id=detection_rules.id AND a.source=$5))`
	args := []any{tenant, options.Search, options.Severity, options.Enabled, options.Source}
	var total int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM detection_rules WHERE `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	order := map[string]string{"name": fold("document->>'name'") + ` COLLATE "C"`, "updated_at": "updated_at", "severity": `CASE document->>'severity' WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`, "detections": "(SELECT count(*) FROM alerts a WHERE a.tenant_id=detection_rules.tenant_id AND a.rule_id=detection_rules.id)"}[options.Sort]
	if order == "" {
		order = "updated_at"
	}
	direction := "DESC"
	if options.Direction == "asc" {
		direction = "ASC"
	}
	args = append(args, options.Limit, options.Offset)
	rows, err := tx.Query(ctx, `SELECT document,version,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'provider',s.provider) ORDER BY s.name COLLATE "C",s.ordinal) FROM api_sources s WHERE s.tenant_id=detection_rules.tenant_id AND s.rule_id=detection_rules.id),'[]'::jsonb) FROM detection_rules WHERE `+where+` ORDER BY `+order+` `+direction+`, id COLLATE "C" ASC LIMIT $6 OFFSET $7`, args...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var record map[string]any
		var version int
		var bindings []map[string]any
		if err = rows.Scan(&record, &version, &bindings); err != nil {
			rows.Close()
			return nil, err
		}
		emptyRuleMetrics(record)
		record["bindings"] = bindings
		record["version"] = version
		items = append(items, record)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = ruleMetrics(ctx, tx, tenant, items); err != nil {
		return nil, err
	}
	rows, err = tx.Query(ctx, `SELECT provider COLLATE "C" FROM api_sources WHERE tenant_id=$1 UNION SELECT source COLLATE "C" FROM alerts WHERE tenant_id=$1 ORDER BY 1`, tenant)
	if err != nil {
		return nil, err
	}
	sources := []string{}
	for rows.Next() {
		var provider string
		if err = rows.Scan(&provider); err != nil {
			rows.Close()
			return nil, err
		}
		sources = append(sources, provider)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := map[string]any{"items": items, "total": total, "limit": options.Limit, "offset": options.Offset, "sources": sources}
	return result, tx.Commit(ctx)
}

// Fetch actual persisted alert statistics for an entire registry page at once.
func ruleMetrics(ctx context.Context, tx pgx.Tx, tenant string, records []map[string]any) error {
	ids := []string{}
	byID := map[string]map[string]any{}
	for _, record := range records {
		id := record["id"].(string)
		ids = append(ids, id)
		byID[id] = record
		bindings := record["bindings"]
		emptyRuleMetrics(record)
		if bindings != nil {
			record["bindings"] = bindings
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT rule_id,count(*),count(DISTINCT investigation_id),max(created_at),count(*) FILTER(WHERE document->>'disposition'='suppressed'),array_agg(DISTINCT source COLLATE "C") FROM alerts WHERE tenant_id=$1 AND rule_id=ANY($2) GROUP BY rule_id`, tenant, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var n, cases, suppressed int
		var latest time.Time
		var sources []string
		if err = rows.Scan(&id, &n, &cases, &latest, &suppressed, &sources); err != nil {
			rows.Close()
			return err
		}
		r := byID[id]
		r["detections"] = n
		r["investigations"] = cases
		r["last_activity_at"] = latest.UTC().Format("2006-01-02T15:04:05.000Z")
		r["suppressed"] = suppressed
		r["sources"] = sources
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = tx.Query(ctx, `SELECT a.rule_id,i.determination,count(DISTINCT i.id) FROM alerts a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id WHERE a.tenant_id=$1 AND a.rule_id=ANY($2) GROUP BY a.rule_id,i.determination ORDER BY i.determination COLLATE "C"`, tenant, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, determination string
		var count int
		if err = rows.Scan(&id, &determination, &count); err != nil {
			return err
		}
		r := byID[id]
		r["outcomes"] = append(r["outcomes"].([]any), map[string]any{"determination": determination, "count": count})
	}
	return rows.Err()
}

func ruleBindings(ctx context.Context, tx pgx.Tx, tenant, id string) ([]map[string]any, error) {
	rows, err := tx.Query(ctx, `SELECT id,name,provider FROM api_sources WHERE tenant_id=$1 AND rule_id=$2 ORDER BY name COLLATE "C",ordinal`, tenant, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, provider string
		if err = rows.Scan(&id, &name, &provider); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "provider": provider})
	}
	return items, rows.Err()
}

// Defaults for rules with no stored alerts.
func emptyRuleMetrics(record map[string]any) {
	record["detections"] = 0
	record["investigations"] = 0
	record["last_activity_at"] = nil
	record["suppressed"] = 0
	record["false_positive_rate"] = nil
	record["outcomes"] = []any{}
	record["sources"] = []any{}
	record["bindings"] = []any{}
	record["period"] = "all_time"
}
