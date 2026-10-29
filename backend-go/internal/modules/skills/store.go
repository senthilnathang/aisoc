package skills

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
)

type Store struct{ Pool *pgxpool.Pool }
type DB interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

var Arrays = []string{"modules", "connectors", "alert_types", "alert_categories", "source_entities", "runtime_entities", "insight_refs", "tags"}

const lowerName = `translate(document->>'name','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')`

func stamp() string             { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func missing(name string) error { return fault.New(404, "NOT_FOUND", name+" not found") }
func editable(r map[string]any) bool {
	return r["origin"] == "user" || r["origin"] == "environment_generated"
}
func get(ctx context.Context, db DB, tenant, id string, lock bool) (map[string]any, error) {
	sql := `SELECT document FROM skills WHERE tenant_id=$1 AND id=$2`
	if lock {
		sql += " FOR UPDATE"
	}
	var r map[string]any
	err := db.QueryRow(ctx, sql, tenant, id).Scan(&r)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing("skill")
	}
	return r, err
}
func (s Store) Get(ctx context.Context, tenant, id string) (map[string]any, error) {
	return get(ctx, s.Pool, tenant, id, false)
}
func audit(ctx context.Context, tx pgx.Tx, tenant, id, action, actor string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	details["actor"] = actor
	now := stamp()
	_, err := tx.Exec(ctx, `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'skill',$3,$4,$5,$6,$6)`, tenant, jobs.ID(), id, action, details, now)
	return err
}
func save(ctx context.Context, tx pgx.Tx, r map[string]any, create bool) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	tags, err := json.Marshal(r["tags"])
	if err != nil {
		return err
	}
	if create {
		_, err = tx.Exec(ctx, `INSERT INTO skills(tenant_id,id,document,tags_search,updated_at) VALUES($1,$2,$3,$4,$5)`, r["tenant_id"], r["id"], raw, string(tags), r["updated_at"])
	} else {
		_, err = tx.Exec(ctx, `UPDATE skills SET document=$3,tags_search=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2`, r["tenant_id"], r["id"], raw, string(tags), r["updated_at"])
	}
	return err
}
func (s Store) Mutate(ctx context.Context, tenant, id, operation, actor string, input map[string]any) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var r map[string]any
	action := operation
	details := map[string]any{}
	if operation == "create" {
		name, _ := input["name"].(string)
		name = strings.TrimSpace(name)
		if name == "" {
			return nil, fault.New(400, "INVALID_SKILL", "Skill name is required.")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant); err != nil {
			return nil, err
		}
		id = "SK-" + jobs.ID()
		now := stamp()
		r = map[string]any{"id": id, "tenant_id": tenant, "skill_type": "strategy", "description": "", "apply_when": "", "content_markdown": "", "origin": "user", "state": "draft", "enabled": false, "version": float64(1), "created_by": actor, "created_at": now, "updated_at": now}
		for _, key := range Arrays {
			r[key] = []any{}
		}
		for k, v := range input {
			r[k] = v
		}
		r["name"] = name
		action = "created"
		details["state"] = "draft"
	} else {
		r, err = get(ctx, tx, tenant, id, true)
		if err != nil {
			if operation == "delete" {
				return nil, missing("Skill")
			}
			return nil, err
		}
		switch operation {
		case "patch":
			if !editable(r) {
				return nil, fault.New(403, "READ_ONLY_SKILL", "This skill cannot be edited.")
			}
			for k, v := range input {
				r[k] = v
			}
			action = "updated"
			details["version"] = r["version"].(float64) + 1
		case "publish":
			r["state"] = "published"
			r["enabled"] = true
			action = "published"
			details["version"] = r["version"].(float64) + 1
		case "toggle":
			if r["state"] != "published" {
				return nil, fault.New(409, "SKILL_NOT_PUBLISHED", "Publish this skill before enabling it.")
			}
			r["enabled"] = !r["enabled"].(bool)
			action = "disabled"
			if r["enabled"] == true {
				action = "enabled"
			}
		case "delete":
			if !editable(r) {
				return nil, missing("Skill")
			}
			if _, err = tx.Exec(ctx, `DELETE FROM skills WHERE tenant_id=$1 AND id=$2`, tenant, id); err != nil {
				return nil, err
			}
			return r, tx.Commit(ctx)
		default:
			return nil, fault.New(400, "INVALID_SKILL", "Invalid skill operation.")
		}
		r["version"] = r["version"].(float64) + 1
		r["updated_at"] = stamp()
	}
	if err = save(ctx, tx, r, operation == "create"); err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, tenant, id, action, actor, details); err != nil {
		return nil, err
	}
	return r, tx.Commit(ctx)
}

type Options struct {
	Search, State, Module string
	Limit, Offset         int
}

func (s Store) List(ctx context.Context, tenant string, o Options) (map[string]any, error) {
	if strings.TrimSpace(o.Search) == "" {
		o.Search = ""
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	where := `tenant_id=$1 AND ($2='' OR document->>'state'=$2) AND ($3='' OR (document->'modules') ? $3) AND ($4='' OR strpos(` + lowerName + `,translate($4,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))>0 OR strpos(translate(document->>'description','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),translate($4,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))>0 OR strpos(translate(tags_search,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),translate($4,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))>0)`
	args := []any{tenant, o.State, o.Module, o.Search}
	var total int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM skills WHERE `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	args = append(args, o.Limit, o.Offset)
	rows, err := tx.Query(ctx, `SELECT document FROM skills WHERE `+where+` ORDER BY updated_at DESC,`+lowerName+` COLLATE "C",ordinal LIMIT $5 OFFSET $6`, args...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var r map[string]any
		if err = rows.Scan(&r); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "limit": o.Limit, "offset": o.Offset}, tx.Commit(ctx)
}
