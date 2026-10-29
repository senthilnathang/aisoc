package investigations

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"time"
)

// Queue retains the legacy raw queue shape, including insight_refs_json. The
// page and unpaginated summary use one snapshot so concurrent phase commits
// cannot make the rows and counts describe different database states.
func (s Store) Queue(ctx context.Context, tenant string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT to_jsonb(i)-'ordinal',j.id,j.status,j.phase,i.created_at,i.updated_at FROM investigations i LEFT JOIN LATERAL (SELECT id,status,phase FROM investigation_jobs WHERE tenant_id=i.tenant_id AND investigation_id=i.id ORDER BY created_at DESC,ordinal DESC LIMIT 1) j ON true WHERE i.tenant_id=$1 ORDER BY i.created_at DESC,i.ordinal DESC LIMIT 100`, tenant)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var item map[string]any
		var id, status *string
		var phase *int
		var created, updated time.Time
		if err = rows.Scan(&item, &id, &status, &phase, &created, &updated); err != nil {
			rows.Close()
			return nil, err
		}
		var refs bytes.Buffer
		encoder := json.NewEncoder(&refs)
		encoder.SetEscapeHTML(false)
		if err = encoder.Encode(item["insight_refs"]); err != nil {
			rows.Close()
			return nil, err
		}
		item["insight_refs_json"] = string(bytes.TrimSuffix(refs.Bytes(), []byte("\n")))
		delete(item, "insight_refs")
		item["created_at"] = Timestamp(created)
		item["updated_at"] = Timestamp(updated)
		item["job_id"] = id
		item["run_status"] = status
		item["run_phase"] = phase
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	var alerts, active, open int
	err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM alerts WHERE tenant_id=$1),(SELECT count(*) FROM investigation_jobs WHERE tenant_id=$1 AND status IN ('queued','running')),(SELECT count(*) FROM investigations WHERE tenant_id=$1 AND status NOT IN ('closed','resolved'))`, tenant).Scan(&alerts, &active, &open)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"items": items, "summary": map[string]any{"alerts": alerts, "active_runs": active, "open_cases": open}}
	return result, tx.Commit(ctx)
}
