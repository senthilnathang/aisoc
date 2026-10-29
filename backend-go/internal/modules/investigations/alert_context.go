package investigations

import (
	"aisoc/backend/internal/platform/fault"
	"context"
	"github.com/jackc/pgx/v5"
)

func steps(ctx context.Context, tx pgx.Tx, tenant, id string) ([]map[string]any, error) {
	rows, err := tx.Query(ctx, `SELECT document FROM investigation_steps WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY created_at,ordinal LIMIT 100`, tenant, id)
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

func assertEditable(ctx context.Context, tx pgx.Tx, tenant, id string) error {
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM investigation_jobs WHERE tenant_id=$1 AND investigation_id=$2 AND status IN ('queued','running'))`, tenant, id).Scan(&active); err != nil {
		return err
	}
	if active {
		return fault.New(409, "INVESTIGATION_RUNNING", "Wait for the current investigation run before changing its outcome.")
	}
	return nil
}
func AlertContext(ctx context.Context, tx pgx.Tx, tenant, id string) ([]map[string]any, []map[string]any, error) {
	rows, err := tx.Query(ctx, `SELECT document FROM alerts WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY created_at DESC,ordinal DESC`, tenant, id)
	if err != nil {
		return nil, nil, err
	}
	alerts := []map[string]any{}
	for rows.Next() {
		var item map[string]any
		if err = rows.Scan(&item); err != nil {
			rows.Close()
			return nil, nil, err
		}
		alerts = append(alerts, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = tx.Query(ctx, `SELECT (to_jsonb(j)-'ordinal')||jsonb_build_object('created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'total_phases',3,'mode','local-deterministic') FROM investigation_jobs j WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY created_at DESC,ordinal DESC LIMIT 20`, tenant, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	jobs := []map[string]any{}
	for rows.Next() {
		var item map[string]any
		if err = rows.Scan(&item); err != nil {
			return nil, nil, err
		}
		jobs = append(jobs, item)
	}
	return alerts, jobs, rows.Err()
}
