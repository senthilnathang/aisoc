package detection

import (
	"aisoc/backend/internal/modules/detection/detectionsql"
	"context"
	"encoding/json"
)

type IntelligenceOptions struct {
	Days                             int
	Source, Severity, Search, RuleID string
}

// One parameterized statement supplies a tenant-bound MVCC snapshot for all panels.
func (s Store) Intelligence(ctx context.Context, tenant string, o IntelligenceOptions) (map[string]any, error) {
	raw, err := detectionsql.New(s.Pool).DetectionIntelligence(ctx, detectionsql.DetectionIntelligenceParams{
		TenantID: tenant, Days: int32(o.Days), Source: o.Source, Severity: o.Severity, Search: o.Search, RuleID: o.RuleID,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]any
	err = json.Unmarshal(raw, &result)
	return result, err
}
