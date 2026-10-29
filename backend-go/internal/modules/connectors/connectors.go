package connectors

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/legacy"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type Store struct {
	Pool *pgxpool.Pool
	Key  []byte
}

func missing() error { return fault.New(404, "NOT_FOUND", "connectors not found") }
func fields(raw map[string]json.RawMessage) (map[string]any, error) {
	values := map[string]any{}
	for _, key := range []string{"type", "name", "description", "workspace_url", "client_id", "config", "status", "last_tested_at"} {
		v, ok := raw[key]
		if !ok {
			continue
		}
		var value any
		var err error
		if key == "config" {
			err = json.Unmarshal(v, &value)
		} else if key == "last_tested_at" && string(v) == "null" {
			value = nil
		} else {
			value, err = legacy.Text(v)
		}
		if err != nil {
			return nil, fault.New(400, "VALIDATION_ERROR", "Invalid connector fields.")
		}
		values[key] = value
	}
	return values, nil
}
func (s Store) Detail(ctx context.Context, tenant, id string) (map[string]any, error) {
	var record map[string]any
	err := s.Pool.QueryRow(ctx, `SELECT document FROM connectors WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&record)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing()
	}
	if err != nil {
		return nil, err
	}
	return record, nil
}
func (s Store) List(ctx context.Context, tenant, search, status string, limit, offset int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT document FROM connectors WHERE tenant_id=$1 AND ($2='' OR document->>'status'=$2) AND ($3='' OR document->>'name' ILIKE $4 ESCAPE '' OR document->>'description' ILIKE $4 ESCAPE '') ORDER BY updated_at DESC,ordinal DESC LIMIT $5 OFFSET $6`, tenant, status, search, "%"+search+"%", limit, offset)
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
		for _, key := range []string{"type", "name"} {
			if values[key] == nil || values[key] == "" {
				return nil, fault.New(400, "VALIDATION_ERROR", "Missing connector fields.")
			}
		}
		id = "CON-" + jobs.ID()[:8]
		record = map[string]any{"id": id, "tenant_id": tenant, "description": "", "workspace_url": "", "client_id": "", "config": map[string]any{}, "status": "untested", "last_tested_at": nil}
	} else {
		err = tx.QueryRow(ctx, `SELECT document FROM connectors WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id).Scan(&record)
		if errors.Is(err, pgx.ErrNoRows) {
			if operation == "test" {
				return nil, fault.New(404, "NOT_FOUND", "connector not found")
			}
			return nil, missing()
		}
		if err != nil {
			return nil, err
		}
	}
	var encrypted []byte
	_, secretChanged := raw["secret"]
	if secretChanged {
		var secret string
		if err = json.Unmarshal(raw["secret"], &secret); err != nil || string(raw["secret"]) == "null" {
			return nil, fault.New(400, "VALIDATION_ERROR", "Connector secret must be a string.")
		}
		encrypted, err = seal(s.Key, tenant, id, secret)
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	switch operation {
	case "create", "patch", "test":
		for k, v := range values {
			record[k] = v
		}
		if operation == "test" {
			record["status"] = "untested"
			keys = []string{"status"}
		}
		changed := operation != "patch" || len(values) > 0 || secretChanged
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
				_, err = tx.Exec(ctx, `INSERT INTO connectors(tenant_id,id,document,updated_at,secret_ciphertext) VALUES($1,$2,$3,$4,$5)`, tenant, id, encoded, now, encrypted)
			} else {
				_, err = tx.Exec(ctx, `UPDATE connectors SET document=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2`, tenant, id, encoded, now)
			}
		}
	case "delete":
		action = "deleted"
		_, err = tx.Exec(ctx, `DELETE FROM connectors WHERE tenant_id=$1 AND id=$2`, tenant, id)
	default:
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid connector operation.")
	}
	if err != nil {
		return nil, err
	}
	if secretChanged && operation != "create" {
		if _, err = tx.Exec(ctx, `UPDATE connectors SET secret_ciphertext=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, encrypted); err != nil {
			return nil, err
		}
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "connectors", id, action, details); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	if operation == "test" {
		result := map[string]any{"status": "unsupported", "message": "No live test adapter is installed for " + record["type"].(string) + ". No provider request was made."}
		if record["type"] == "crowdstrike" {
			result = map[string]any{"status": "not_configured", "message": "CrowdStrike read-only adapter is not configured yet. No provider request was made."}
		}
		record["test_result"] = result
	}
	return record, nil
}
