package investigations

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

// AddRecord serializes additions with case deletion and commits the audit atomically.
func (s Store) AddRecord(ctx context.Context, tenant, id, kind string, fields map[string]any) (map[string]any, error) {
	if kind != "artifacts" && kind != "feedback" {
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid case record kind.")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err = Lock(ctx, tx, tenant, id); err != nil {
		return nil, err
	}
	record := map[string]any{}
	for k, v := range fields {
		record[k] = v
	}
	recordID := jobs.ID()
	now := time.Now().UTC().Truncate(time.Millisecond)
	record["id"] = recordID
	record["tenant_id"] = tenant
	record["investigation_id"] = id
	record["created_at"] = Timestamp(now)
	record["updated_at"] = Timestamp(now)
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`, tenant, recordID, id, kind, raw, now)
	if err != nil {
		return nil, err
	}
	action := "feedback_added"
	if kind == "artifacts" {
		action = "evidence_added"
	}
	if err = Audit(ctx, tx, tenant, id, action, map[string]any{"record_id": recordID}); err != nil {
		return nil, err
	}
	return record, tx.Commit(ctx)
}

func records(ctx context.Context, tx pgx.Tx, tenant, id, kind string) ([]map[string]any, error) {
	rows, err := tx.Query(ctx, `SELECT document FROM case_records WHERE tenant_id=$1 AND investigation_id=$2 AND kind=$3 ORDER BY updated_at DESC,ordinal DESC LIMIT 100`, tenant, id, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var item map[string]any
		if err = rows.Scan(&item); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// Reinvestigate enqueues a new run for alert-backed cases and preserves the
// existing manual-case behavior when there is no source alert.
func (s Store) Reinvestigate(ctx context.Context, tenant, id string) (Record, error) {
	return s.changeOutcome(ctx, tenant, id, "", true)
}
func (s Store) Determine(ctx context.Context, tenant, id, determination string) (Record, error) {
	if !contains([]string{"unknown", "benign", "suspicious", "malicious", "mitigated"}, determination) {
		return Record{}, fault.New(400, "VALIDATION_ERROR", "Invalid determination.")
	}
	return s.changeOutcome(ctx, tenant, id, determination, false)
}
func (s Store) changeOutcome(ctx context.Context, tenant, id, value string, replay bool) (Record, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx)
	if err = Lock(ctx, tx, tenant, id); err != nil {
		return Record{}, err
	}
	query := `UPDATE investigations SET determination=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING ` + columns
	if err = assertEditable(ctx, tx, tenant, id); err != nil {
		return Record{}, err
	}
	action := "updated"
	details := map[string]any{"fields": []string{"determination"}}
	if replay {
		value = "unknown"
		query = `UPDATE investigations SET determination=$3,status='investigating',replay_count=replay_count+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING ` + columns
		action = "reinvestigated"
		details = map[string]any{"queued": false}
		var alertID string
		err = tx.QueryRow(ctx, `SELECT id FROM alerts WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY ordinal LIMIT 1`, tenant, id).Scan(&alertID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Record{}, err
		}
		if err == nil {
			now := time.Now().UTC().Truncate(time.Millisecond)
			if _, err = tx.Exec(ctx, `INSERT INTO investigation_jobs(tenant_id,id,investigation_id,alert_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`, tenant, "JOB-"+jobs.ID(), id, alertID, now); err != nil {
				return Record{}, err
			}
			if err = Audit(ctx, tx, tenant, id, "investigation_queued", map[string]any{"alert_id": alertID}); err != nil {
				return Record{}, err
			}
			query = `UPDATE investigations SET determination=$3,status='open',replay_count=replay_count+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING ` + columns
			details = map[string]any{"queued": true}
		}
	}
	result, err := scan(tx.QueryRow(ctx, query, tenant, id, value, time.Now().UTC().Truncate(time.Millisecond)))
	if err != nil {
		return Record{}, err
	}
	if err = Audit(ctx, tx, tenant, id, action, details); err != nil {
		return Record{}, err
	}
	return result, tx.Commit(ctx)
}
