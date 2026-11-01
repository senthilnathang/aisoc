// Package approvals provides a read-only, tenant-scoped projection of workflow owners.
package approvals

import (
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
	"unicode/utf8"
)

type Store struct{ Pool *pgxpool.Pool }

func (s Store) Inbox(ctx context.Context, tenant, kind, stage, search string, limit, offset int) (map[string]any, error) {
	if (kind != "all" && kind != "skill" && kind != "memory" && kind != "respond") || (stage != "all" && stage != "review" && stage != "execution") || limit < 1 || limit > 50 || offset < 0 || offset > 1000000 || utf8.RuneCountInString(search) > 200 || strings.ContainsRune(search, 0) {
		return nil, fault.New(400, "INVALID_FILTER", "Invalid approval inbox filters.")
	}
	raw, err := investigationsql.New(s.Pool).ApprovalInbox(ctx, investigationsql.ApprovalInboxParams{TenantID: tenant, Kind: kind, Stage: stage, Search: strings.TrimSpace(search), PageLimit: int32(limit), PageOffset: int32(offset)})
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err = json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	now := time.Now()
	for _, entry := range out["items"].([]any) {
		item := entry.(map[string]any)
		token := workToken(item)
		item["work_token"] = token
		a, _ := item["assignment"].(map[string]any)
		state := "unassigned"
		if text(a["owner_id"]) != "" {
			state = "owned"
			if a["work_token"] != token {
				state = "revision_changed"
			} else if !expiry(a["expires_at"]).After(now) {
				state = "expired"
			}
		}
		a["state"] = state
	}
	out["limit"] = limit
	out["offset"] = offset
	out["mode"] = "local/mock"
	return out, nil
}
