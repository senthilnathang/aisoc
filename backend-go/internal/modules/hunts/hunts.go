package hunts

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/legacy"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
	"unicode/utf16"
)

type Store struct{ Pool *pgxpool.Pool }

func missing() error { return fault.New(404, "NOT_FOUND", "hunts not found") }
func fields(raw map[string]json.RawMessage) (map[string]any, error) {
	values := map[string]any{}
	for _, key := range []string{"name", "query", "source", "status", "verdict", "findings_count", "last_run_at", "insight_refs"} {
		v, ok := raw[key]
		if !ok {
			continue
		}
		var value any
		var err error
		switch key {
		case "insight_refs":
			err = json.Unmarshal(v, &value)
		case "findings_count":
			value, err = legacy.Integer(v)
		default:
			if (key == "verdict" || key == "last_run_at") && string(v) == "null" {
				value = nil
			} else {
				value, err = legacy.Text(v)
			}
		}
		if err != nil {
			return nil, fault.New(400, "VALIDATION_ERROR", "Invalid hunt fields.")
		}
		values[key] = value
	}
	return values, nil
}
func (s Store) Detail(ctx context.Context, tenant, id string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var record map[string]any
	err = tx.QueryRow(ctx, `SELECT document FROM hunts WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&record)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing()
	}
	if err != nil {
		return nil, err
	}
	record["skill_applications"], err = skills.Applications(ctx, tx, tenant, "hunt", id)
	if err != nil {
		return nil, err
	}
	return record, tx.Commit(ctx)
}

func (s Store) List(ctx context.Context, tenant, search, status string, limit, offset int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT document FROM hunts WHERE tenant_id=$1 AND ($2='' OR document->>'status'=$2) AND ($3='' OR document->>'name' ILIKE $4 ESCAPE '' OR document->>'query' ILIKE $4 ESCAPE '') ORDER BY updated_at DESC,ordinal DESC LIMIT $5 OFFSET $6`, tenant, status, search, "%"+search+"%", limit, offset)
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
func (s Store) Mutate(ctx context.Context, tenant, id, operation string, raw map[string]json.RawMessage, keys []string) (map[string]any, error) {
	values, err := fields(raw)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var record map[string]any
	action := "updated"
	var details map[string]any
	if operation == "create" {
		if _, err = tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant); err != nil {
			return nil, err
		}
		for _, key := range []string{"name", "query"} {
			if values[key] == nil || values[key] == "" {
				return nil, fault.New(400, "VALIDATION_ERROR", "Missing hunt fields.")
			}
		}
		id = "HUNT-" + jobs.ID()[:8]
		record = map[string]any{"id": id, "tenant_id": tenant, "source": "ad_hoc", "status": "draft", "verdict": nil, "findings_count": 0, "last_run_at": nil, "insight_refs": []any{}}
	} else {
		err = tx.QueryRow(ctx, `SELECT document FROM hunts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id).Scan(&record)
		if errors.Is(err, pgx.ErrNoRows) {
			if operation == "run" {
				return nil, fault.New(404, "NOT_FOUND", "hunt not found")
			}
			return nil, missing()
		}
		if err != nil {
			return nil, err
		}
	}
	var applied []map[string]any
	now := time.Now().UTC().Truncate(time.Millisecond)
	switch operation {
	case "create", "patch", "run":
		for k, v := range values {
			record[k] = v
		}
		if operation == "run" {
			refs := []string{}
			if a, ok := record["insight_refs"].([]any); ok {
				for _, v := range a {
					if v, ok := v.(string); ok {
						refs = append(refs, v)
					}
				}
			}
			applied, err = skills.Apply(ctx, tx, tenant, "hunt", id, skills.Context{Module: "hunting", Source: record["source"].(string), Title: record["name"].(string) + " " + record["query"].(string), SourceEntities: []string{record["query"].(string)}, InsightRefs: refs})
			if err != nil {
				return nil, err
			}
			// Preserve the legacy deterministic simulation; this executes no query or tool.
			findings := len(utf16.Encode([]rune(id)))%4 + 1
			verdict := "no_findings"
			if findings > 1 {
				verdict = "review_required"
			}
			record["status"] = "completed"
			record["verdict"] = verdict
			record["findings_count"] = findings
			record["last_run_at"] = investigations.Timestamp(now)
			keys = []string{"status", "verdict", "findings_count", "last_run_at"}
		}
		changed := operation != "patch" || len(values) > 0
		if changed {
			record["updated_at"] = investigations.Timestamp(now)
		}
		if operation == "create" {
			record["created_at"] = investigations.Timestamp(now)
			action = "created"
		} else {
			auditKeys := []string{}
			for _, key := range keys {
				if key != "secret" {
					auditKeys = append(auditKeys, key)
				}
			}
			details = map[string]any{"fields": auditKeys}
		}
		if changed {
			encoded, e := json.Marshal(record)
			if e != nil {
				return nil, e
			}
			if operation == "create" {
				_, err = tx.Exec(ctx, `INSERT INTO hunts(tenant_id,id,document,updated_at) VALUES($1,$2,$3,$4)`, tenant, id, encoded, now)
			} else {
				_, err = tx.Exec(ctx, `UPDATE hunts SET document=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2`, tenant, id, encoded, now)
			}
		}
	case "delete":
		action = "deleted"
		_, err = tx.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1 AND id=$2`, tenant, id)
	default:
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid hunt operation.")
	}
	if err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "hunts", id, action, details); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	if operation == "run" {
		record["applied_skills"] = applied
	}
	return record, nil
}
