package build

import (
	"aisoc/backend/internal/modules/build/buildsql"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"unicode/utf8"
)

type Store struct{ Pool *pgxpool.Pool }

func (s Store) Catalog(ctx context.Context, tenant, kind, search string, limit, offset int) (map[string]any, error) {
	invalid := func() error { return fault.New(400, "INVALID_FILTER", "Invalid Build catalog filters.") }
	switch kind {
	case "all", "skill", "workflow", "runbook", "api_source", "connector":
	default:
		return nil, invalid()
	}
	if limit < 1 || limit > 100 || offset < 0 || offset > 1000000 || utf8.RuneCountInString(search) > 200 || strings.ContainsRune(search, 0) {
		return nil, invalid()
	}
	raw, err := buildsql.New(s.Pool).Catalog(ctx, buildsql.CatalogParams{TenantID: tenant, Kind: kind, Search: strings.TrimSpace(search), PageLimit: int32(limit), PageOffset: int32(offset)})
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	result["limit"] = limit
	result["offset"] = offset
	return result, nil
}
