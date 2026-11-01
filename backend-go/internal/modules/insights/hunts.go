package insights

import (
	"aisoc/backend/internal/modules/insights/insightsql"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

// HuntSnapshots uses the same exact-key, validity and source-revision rules as
// investigation context, restricted to analyst-authored/reviewed records. The
// caller stores these snapshots in its immutable run and owns the transaction.
func HuntSnapshots(ctx context.Context, tx pgx.Tx, tenant, huntID, runID, actor, capturedAt string, entities []string) ([]map[string]any, bool, error) {
	keys := []string{}
	seen := map[string]bool{}
	for _, entity := range entities {
		v := key(entity)
		if v != "" && len(v) <= 1200 && !seen[v] {
			keys = append(keys, v)
			seen[v] = true
		}
	}
	out := []map[string]any{}
	if len(keys) == 0 {
		return out, false, nil
	}
	q := insightsql.New(tx)
	rows, err := q.HuntMatchingInsights(ctx, insightsql.HuntMatchingInsightsParams{TenantID: tenant, Entities: keys})
	if err != nil {
		return nil, false, err
	}
	truncated := len(rows) > 20
	if len(rows) > 20 {
		rows = rows[:20]
	}
	size := 2 // JSON array brackets; include a comma budget for each entry.
	for _, row := range rows {
		snapshot, err := record(row)
		if err != nil {
			return nil, false, err
		}
		snapshot["captured_at"] = capturedAt
		snapshot["matched_entity"] = row.ArtifactKey
		snapshot["eligibility"] = "current_at_capture"
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return nil, false, err
		}
		if size+len(encoded)+1 > 65536 {
			truncated = true
			break
		}
		size += len(encoded) + 1
		out = append(out, snapshot)
		details, _ := json.Marshal(map[string]any{"actor": actor, "hunt_id": huntID, "run_id": runID, "version": row.Version, "artifact": row.ArtifactKey})
		if err = q.InsightAudit(ctx, insightsql.InsightAuditParams{TenantID: tenant, ID: jobs.ID(), ResourceID: row.ID, Action: "applied_to_hunt", Details: details}); err != nil {
			return nil, false, err
		}
	}
	return out, truncated, nil
}
