package navigation

import (
	"aisoc/backend/internal/modules/navigation/navigationsql"
	"aisoc/backend/internal/platform/fault"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Store struct{ Pool *pgxpool.Pool }

// Label returns bounded display metadata only. No caller-supplied tenant or SQL
// identifier is accepted; all four indexed lookups use the authenticated tenant.
func (s Store) Label(ctx context.Context, tenant, resource, id string) (string, error) {
	switch resource {
	case "investigations", "detection-rules", "threat-intel", "skills":
	default:
		return "", fault.New(400, "VALIDATION_ERROR", "Invalid breadcrumb resource")
	}
	if id == "" || len(id) > 256 || !utf8.ValidString(id) || strings.IndexFunc(id, unicode.IsControl) >= 0 {
		return "", fault.New(400, "VALIDATION_ERROR", "Invalid breadcrumb identifier")
	}
	label, err := navigationsql.New(s.Pool).BreadcrumbLabel(ctx, navigationsql.BreadcrumbLabelParams{TenantID: tenant, ID: id, Resource: resource})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fault.New(404, "NOT_FOUND", "Resource not found")
	}
	return label, err
}
