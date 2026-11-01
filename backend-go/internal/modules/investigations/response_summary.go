package investigations

import (
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"context"
)

// ResponseSummary counts every tenant record, independent of list pagination.
func (s Store) ResponseSummary(ctx context.Context, tenant string) (map[string]int64, error) {
	result, err := investigationsql.New(s.Pool).ResponseSummary(ctx, tenant)
	if err != nil {
		return nil, err
	}
	return map[string]int64{"pending": result.Pending, "completed": result.Completed, "cases": result.Cases, "workflows": result.Workflows}, nil
}
