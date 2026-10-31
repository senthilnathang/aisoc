package detection

import (
	"aisoc/backend/internal/modules/detection/detectionsql"
	"context"
	"encoding/json"
)

func (s Store) RegistryWindow(ctx context.Context, tenant string, o RegistryOptions, id string) (map[string]any, error) {
	raw, err := detectionsql.New(s.Pool).RegistryWindow(ctx, detectionsql.RegistryWindowParams{
		TenantID: tenant, RuleID: id, Search: o.Search, Severity: o.Severity, Enabled: o.Enabled, Source: o.Source,
		Days: int32(o.Days), Sort: o.Sort, Direction: o.Direction, PageLimit: int32(o.Limit), PageOffset: int64(o.Offset),
	})
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if id != "" && result["total"] == float64(0) {
		return nil, missing()
	}
	return result, nil
}
