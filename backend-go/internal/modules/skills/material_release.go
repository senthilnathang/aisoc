package skills

import (
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

func CaptureMaterialsTx(ctx context.Context, tx pgx.Tx, tenant, id string) ([]any, error) {
	rows, e := investigationsql.New(tx).ReleasedMaterials(ctx, investigationsql.ReleasedMaterialsParams{TenantID: tenant, SkillID: id})
	if e != nil {
		return nil, e
	}
	out := []any{}
	for _, raw := range rows {
		var item map[string]any
		if e = json.Unmarshal(raw, &item); e != nil {
			return nil, e
		}
		out = append(out, item)
	}
	return out, nil
}
func RestoreMaterialsTx(ctx context.Context, tx pgx.Tx, tenant, id, actor string, release []any) error {
	q := investigationsql.New(tx)
	ids := []string{}
	for _, v := range release {
		ids = append(ids, v.(map[string]any)["id"].(string))
	}
	if e := q.ArchiveDraftMaterials(ctx, investigationsql.ArchiveDraftMaterialsParams{TenantID: tenant, SkillID: id, Retained: ids}); e != nil {
		return e
	}
	for _, v := range release {
		m := v.(map[string]any)
		raw, _ := json.Marshal(m)
		if e := q.RestoreReleasedMaterial(ctx, investigationsql.RestoreReleasedMaterialParams{TenantID: tenant, SkillID: id, ID: m["id"].(string), Snapshot: raw, Actor: actor}); e != nil {
			return e
		}
	}
	return nil
}
