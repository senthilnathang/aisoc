package skills

import (
	"aisoc/backend/internal/modules/skills/skillsql"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"math"
	"strings"
	"unicode/utf8"
)

func validateMutation(operation string, input map[string]any) error {
	invalid := func() error { return fault.New(400, "INVALID_SKILL", "Invalid skill fields or revision.") }
	for k, v := range input {
		switch k {
		case "expected_version":
			n, ok := v.(float64)
			if !ok || n < 1 || n > 2147483647 || math.Trunc(n) != n {
				return invalid()
			}
		case "enabled":
			if operation != "set-enabled" {
				return invalid()
			}
			if _, ok := v.(bool); !ok {
				return invalid()
			}
		case "name", "description", "apply_when", "content_markdown", "skill_type":
			text, ok := v.(string)
			if !ok {
				return invalid()
			}
			max := 4000
			if k == "name" {
				max = 200
				if strings.TrimSpace(text) == "" {
					return invalid()
				}
			}
			if k == "content_markdown" {
				max = 30000
			}
			if utf8.RuneCountInString(text) > max || strings.ContainsRune(text, 0) {
				return invalid()
			}
			if k == "skill_type" && text != "strategy" && text != "content" {
				return invalid()
			}
		default:
			found := false
			for _, a := range Arrays {
				if k == a {
					found = true
				}
			}
			if !found {
				return invalid()
			}
			var values []string
			switch a := v.(type) {
			case []string:
				values = a
			case []any:
				for _, item := range a {
					text, ok := item.(string)
					if !ok {
						return invalid()
					}
					values = append(values, text)
				}
			default:
				return invalid()
			}
			max, count := 200, 100
			switch k {
			case "modules":
				max, count = 100, 20
			case "connectors", "alert_types", "alert_categories":
				max = 120
			case "tags":
				max = 100
			}
			if len(values) > count {
				return invalid()
			}
			for _, text := range values {
				if strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > max || strings.ContainsRune(text, 0) {
					return invalid()
				}
			}

		}
	}
	if operation == "save-publish" || operation == "set-enabled" {
		if _, ok := input["expected_version"]; !ok {
			return invalid()
		}
	}
	if operation == "set-enabled" {
		if _, ok := input["enabled"].(bool); !ok {
			return invalid()
		}
		if len(input) != 2 {
			return invalid()
		}
	}
	return nil
}

func (s Store) Library(ctx context.Context, tenant string, o Options, origin string) (map[string]any, error) {
	if o.Limit < 1 || o.Limit > 100 || o.Offset < 0 || o.Offset > 1000000 || utf8.RuneCountInString(o.Search) > 200 || len(o.Module) > 100 || (o.State != "" && o.State != "draft" && o.State != "published") || (origin != "" && origin != "custom" && origin != "augmented") {
		return nil, fault.New(400, "INVALID_FILTER", "Invalid library filters.")
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := skillsql.New(tx)
	counts, err := q.LibraryCounts(ctx, skillsql.LibraryCountsParams{TenantID: tenant, State: o.State, Module: o.Module, Search: strings.TrimSpace(o.Search), Origin: origin})
	if err != nil {
		return nil, err
	}
	rows, err := q.LibrarySkills(ctx, skillsql.LibrarySkillsParams{TenantID: tenant, State: o.State, Module: o.Module, Search: strings.TrimSpace(o.Search), Origin: origin, PageLimit: int32(o.Limit), PageOffset: int32(o.Offset)})
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, raw := range rows {
		var item map[string]any
		if err = json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"items": items, "total": counts.Total, "published": counts.Published, "drafts": counts.Drafts, "limit": o.Limit, "offset": o.Offset}, tx.Commit(ctx)
}
