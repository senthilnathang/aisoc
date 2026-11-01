package insights

import (
	"aisoc/backend/internal/modules/insights/insightsql"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"time"
)

// Apply records exact entity context. It never changes verdicts or performs actions.
// Callers own the investigation transaction/lock; snapshots are replay-safe per version.
func Apply(ctx context.Context, tx pgx.Tx, tenant, caseID string, entities []string) ([]string, error) {
	keys := []string{}
	seen := map[string]bool{}
	for _, s := range entities {
		v := key(s)
		if v != "" && !seen[v] {
			keys = append(keys, v)
			seen[v] = true
		}
	}
	refs := []string{}
	if len(keys) == 0 {
		return refs, nil
	}
	q := insightsql.New(tx)
	rows, err := q.MatchingInsights(ctx, insightsql.MatchingInsightsParams{TenantID: tenant, Entities: keys})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		refs = append(refs, r.ID)
		snapshot, err := record(r)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return nil, err
		}
		n, err := q.InsertApplication(ctx, insightsql.InsertApplicationParams{TenantID: tenant, InsightID: r.ID, InvestigationID: caseID, InsightVersion: r.Version, Snapshot: encoded})
		if err != nil {
			return nil, err
		}
		if n == 0 {
			continue
		}
		now := time.Now().UTC()
		id := "STEP-EI-" + jobs.ID()
		step := map[string]any{"id": id, "tenant_id": tenant, "investigation_id": caseID, "title": "Enterprise insight: " + snapshot["artifact"].(string), "conclusion": snapshot["content"], "tool": "AISOC Enterprise Insights", "request": map[string]any{"insight_id": r.ID, "version": r.Version, "snapshot": snapshot}, "response": map[string]any{"context_recorded": true, "advisory_hint": snapshot["hint"], "verdict_changed": false, "automated_actions": false}, "created_at": now, "updated_at": now}
		raw, err := json.Marshal(step)
		if err != nil {
			return nil, err
		}
		if err = q.InsightStep(ctx, insightsql.InsightStepParams{TenantID: tenant, ID: id, InvestigationID: caseID, Document: raw}); err != nil {
			return nil, err
		}
		details, _ := json.Marshal(map[string]any{"investigation_id": caseID, "version": r.Version, "artifact": snapshot["artifact"]})
		if err = q.InsightAudit(ctx, insightsql.InsightAuditParams{TenantID: tenant, ID: jobs.ID(), ResourceID: r.ID, Action: "applied", Details: details}); err != nil {
			return nil, err
		}
	}
	return refs, nil
}
