package investigations

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type Dashboard struct {
	QueueItems            int64    `json:"queueItems"`
	OpenInvestigations    int64    `json:"openInvestigations"`
	OpenRemediations      int64    `json:"openRemediations"`
	EnabledDetectionRules int64    `json:"enabledDetectionRules"`
	OperationalConnectors int64    `json:"operationalConnectors"`
	RecentInvestigations  []Record `json:"recentInvestigations"`
}

// Counts are tenant-wide, not limited by resource pagination. A repeatable-read
// snapshot keeps the five recent records consistent with every aggregate.
func (s Store) Dashboard(ctx context.Context, tenant string) (Dashboard, error) {
	result := Dashboard{RecentInvestigations: []Record{}}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT
  (SELECT count(*) FROM investigations WHERE tenant_id=$1 AND status NOT IN ('resolved','closed')),
  (SELECT count(*) FROM investigations WHERE tenant_id=$1 AND status IN ('open','investigating')),
  (SELECT count(*) FROM remediations WHERE tenant_id=$1 AND document->>'status'='pending'),
  (SELECT count(*) FROM detection_rules WHERE tenant_id=$1 AND document->'enabled'='true'::jsonb),
  (SELECT count(*) FROM connectors WHERE tenant_id=$1 AND document->>'status'='operational')`, tenant).Scan(&result.QueueItems, &result.OpenInvestigations, &result.OpenRemediations, &result.EnabledDetectionRules, &result.OperationalConnectors)
	if err != nil {
		return result, err
	}
	rows, err := tx.Query(ctx, `SELECT `+columns+` FROM investigations WHERE tenant_id=$1 ORDER BY updated_at DESC,id LIMIT 5`, tenant)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		r, e := scan(rows)
		if e != nil {
			rows.Close()
			return result, e
		}
		result.RecentInvestigations = append(result.RecentInvestigations, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
