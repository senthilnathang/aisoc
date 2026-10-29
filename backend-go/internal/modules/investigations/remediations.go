package investigations

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// RemediationRecords supplies both the response collection and the case snapshot.
func RemediationRecords(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, tenant, caseID, status, search string, limit, offset int) ([]map[string]any, error) {
	rows, err := db.Query(ctx, `SELECT document FROM remediations WHERE tenant_id=$1 AND ($2='' OR investigation_id=$2) AND ($3='' OR document->>'status'=$3) AND ($4='' OR document->>'title' ILIKE $5 ESCAPE '' OR document->>'description' ILIKE $5 ESCAPE '') ORDER BY updated_at DESC,ordinal DESC LIMIT $6 OFFSET $7`, tenant, caseID, status, search, "%"+search+"%", limit, offset)
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
