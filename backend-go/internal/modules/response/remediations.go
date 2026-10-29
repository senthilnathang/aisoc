package response

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/legacy"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"sort"
	"time"
)

func remediationMissing() error { return fault.New(404, "NOT_FOUND", "remediation not found") }
func remediationFields(fields map[string]json.RawMessage) (map[string]any, error) {
	result := map[string]any{}
	for _, key := range []string{"investigation_id", "action_type", "title", "description", "connector", "status", "executed_at"} {
		if raw, ok := fields[key]; ok {
			if key == "executed_at" && string(raw) == "null" {
				result[key] = nil
				continue
			}
			value, err := legacy.Text(raw)
			if err != nil {
				return nil, fault.New(400, "VALIDATION_ERROR", "Invalid remediation fields.")
			}
			result[key] = value
		}
	}
	return result, nil
}
func (s Store) Remediation(ctx context.Context, tenant, id string) (map[string]any, error) {
	var result map[string]any
	err := s.Pool.QueryRow(ctx, `SELECT document FROM remediations WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&result)
	if errors.Is(err, pgx.ErrNoRows) {
		err = remediationMissing()
	}
	return result, err
}
func (s Store) CreateRemediation(ctx context.Context, tenant string, fields map[string]json.RawMessage) (map[string]any, error) {
	values, err := remediationFields(fields)
	if err != nil {
		return nil, err
	}
	for _, key := range []string{"investigation_id", "action_type", "title"} {
		if values[key] == nil || values[key] == "" {
			return nil, fault.New(400, "VALIDATION_ERROR", "Missing remediation fields.")
		}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	caseID := values["investigation_id"].(string)
	if err = investigations.Lock(ctx, tx, tenant, caseID); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := "REM-" + jobs.ID()[:8]
	record := map[string]any{"description": "", "connector": "", "status": "pending", "executed_at": nil}
	for k, v := range values {
		record[k] = v
	}
	record["id"] = id
	record["tenant_id"] = tenant
	record["created_at"] = investigations.Timestamp(now)
	record["updated_at"] = investigations.Timestamp(now)
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO remediations(tenant_id,id,investigation_id,document,updated_at) VALUES($1,$2,$3,$4,$5)`, tenant, id, caseID, raw, now); err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "remediations", id, "created", nil); err != nil {
		return nil, err
	}
	return record, tx.Commit(ctx)
}

// Case locks precede remediation locks, matching case deletion. If a concurrent
// reassignment changed the parent, retry with the current ordered parent locks.
func (s Store) MutateRemediation(ctx context.Context, tenant, id, operation string, fields map[string]json.RawMessage, keys []string) (map[string]any, error) {
	values, err := remediationFields(fields)
	if err != nil {
		return nil, err
	}
	for attempt := 0; attempt < 5; attempt++ {
		before, err := s.Remediation(ctx, tenant, id)
		if err != nil {
			return nil, err
		}
		original := before["investigation_id"].(string)
		parents := []string{original}
		if next, ok := values["investigation_id"].(string); ok && next != original {
			parents = append(parents, next)
		}
		sort.Strings(parents)
		result, retry, err := s.mutateRemediation(ctx, tenant, id, operation, original, parents, values, keys)
		if !retry {
			return result, err
		}
	}
	return nil, fault.New(409, "VERSION_CONFLICT", "Remediation changed. Retry the request.")
}
func (s Store) mutateRemediation(ctx context.Context, tenant, id, operation, original string, parents []string, values map[string]any, keys []string) (map[string]any, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)
	for _, parent := range parents {
		if err = investigations.Lock(ctx, tx, tenant, parent); err != nil {
			return nil, false, err
		}
	}
	var record map[string]any
	err = tx.QueryRow(ctx, `SELECT document FROM remediations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id).Scan(&record)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, remediationMissing()
	}
	if err != nil {
		return nil, false, err
	}
	if record["investigation_id"] != original {
		return nil, true, nil
	}
	action := "updated"
	details := map[string]any{}
	if operation == "delete" {
		action = "deleted"
		_, err = tx.Exec(ctx, `DELETE FROM remediations WHERE tenant_id=$1 AND id=$2`, tenant, id)
	} else {
		changed := len(values) > 0
		now := time.Now().UTC().Truncate(time.Millisecond)
		for k, v := range values {
			record[k] = v
		}
		if operation == "execute" {
			record["status"] = "completed"
			record["executed_at"] = investigations.Timestamp(now)
			keys = []string{"status", "executed_at"}
			changed = true
		}
		auditKeys := []string{}
		for _, key := range keys {
			if key != "secret" {
				auditKeys = append(auditKeys, key)
			}
		}
		details["fields"] = auditKeys
		if changed {
			record["updated_at"] = investigations.Timestamp(now)
			var raw []byte
			raw, err = json.Marshal(record)
			if err == nil {
				_, err = tx.Exec(ctx, `UPDATE remediations SET investigation_id=$3,document=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2`, tenant, id, record["investigation_id"], raw, now)
			}
		}
	}
	if err != nil {
		return nil, false, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "remediations", id, action, details); err != nil {
		return nil, false, err
	}
	return record, false, tx.Commit(ctx)
}
