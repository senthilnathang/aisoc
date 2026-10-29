package skills

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/url"
	"strings"
	"unicode/utf16"
)

func material(ctx context.Context, db DB, tenant, skill, id string) (map[string]any, error) {
	var r map[string]any
	err := db.QueryRow(ctx, `SELECT document FROM skill_materials WHERE tenant_id=$1 AND skill_id=$2 AND id=$3`, tenant, skill, id).Scan(&r)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing("material")
	}
	return r, err
}
func (s Store) Material(ctx context.Context, tenant, skill, id string) (map[string]any, error) {
	return material(ctx, s.Pool, tenant, skill, id)
}
func (s Store) Materials(ctx context.Context, tenant, skill string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = get(ctx, tx, tenant, skill, false); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT document-'content'-'archived_at' FROM skill_materials WHERE tenant_id=$1 AND skill_id=$2 AND document->>'archived_at' IS NULL ORDER BY `+lowerName+` COLLATE "C",ordinal`, tenant, skill)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var r map[string]any
		if err = rows.Scan(&r); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, tx.Commit(ctx)
}
func (s Store) Versions(ctx context.Context, tenant, skill, id string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = material(ctx, tx, tenant, skill, id); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT version,snapshot,created_by,created_at FROM skill_material_versions WHERE tenant_id=$1 AND material_id=$2 ORDER BY version DESC`, tenant, id)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var version int
		var snap map[string]any
		var actor, at string
		if err = rows.Scan(&version, &snap, &actor, &at); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, map[string]any{"version": version, "snapshot": snap, "created_by": actor, "created_at": at})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, tx.Commit(ctx)
}
func materialError(code, message string) error { return fault.New(400, code, message) }
func validURL(source string) bool {
	u, err := url.Parse(source)
	return err == nil && u.Scheme != "" && u.Host != ""
}
func materialInput(current, input map[string]any, create bool) (map[string]any, error) {
	r := map[string]any{}
	for k, v := range current {
		r[k] = v
	}
	if create {
		r = map[string]any{"name": "", "kind": "reference", "source_url": nil, "content": "", "version": float64(1), "archived_at": nil}
		if name, ok := input["name"]; ok {
			r["name"] = name
		} else if filename, ok := input["filename"]; ok {
			r["name"] = filename
		}
	}
	for _, key := range []string{"name", "kind", "source_url", "content"} {
		if v, ok := input[key]; ok {
			r[key] = v
		}
	}
	name := strings.TrimSpace(r["name"].(string))
	if name == "" || len(utf16.Encode([]rune(name))) > 180 {
		return nil, materialError("INVALID_MATERIAL", "Provide a material name of 1 to 180 characters.")
	}
	r["name"] = name
	kind := r["kind"].(string)
	if kind != "reference" && kind != "checklist" && kind != "example" {
		return nil, materialError("INVALID_MATERIAL_KIND", "Material kind must be reference, checklist, or example.")
	}
	source, _ := r["source_url"].(string)
	source = strings.TrimSpace(source)
	r["source_url"] = nil
	if source != "" {
		r["source_url"] = source
	}
	content := r["content"].(string)
	tooLarge := func() error { return fault.New(413, "MATERIAL_TOO_LARGE", "Each material must be 128 KB or smaller.") }
	if !create && len(content) > 128*1024 {
		return nil, tooLarge()
	}
	if source != "" {
		if !validURL(source) {
			return nil, materialError("INVALID_MATERIAL_URL", "Reference URL must be a valid HTTPS link.")
		}
		u, _ := url.Parse(source)
		if create {
			if u.Scheme != "https" {
				return nil, materialError("INVALID_MATERIAL_URL", "Reference URL must use HTTPS.")
			}
			if content != "" {
				return nil, materialError("INVALID_MATERIAL", "A URL reference cannot also contain file content.")
			}
			r["file_type"] = "url"
		} else if u.Scheme != "https" || content != "" {
			return nil, materialError("INVALID_MATERIAL_URL", "Use an HTTPS link without file content.")
		}
	} else {
		if create {
			filename, _ := input["filename"].(string)
			if filename == "" {
				filename = name
			}
			parts := strings.Split(filename, ".")
			ext := strings.ToLower(parts[len(parts)-1])
			typ := map[string]string{"md": "markdown", "markdown": "markdown", "txt": "text", "json": "json", "csv": "csv"}[ext]
			if typ == "" {
				return nil, materialError("UNSUPPORTED_MATERIAL_TYPE", "Use a Markdown, TXT, JSON, or CSV file, or add an HTTPS URL reference.")
			}
			r["file_type"] = typ
		}
		if strings.TrimSpace(content) == "" {
			message := "Material content cannot be empty."
			if create {
				message = "The uploaded material is empty."
			}
			return nil, materialError("EMPTY_MATERIAL", message)
		}
		if len(content) > 128*1024 {
			return nil, tooLarge()
		}
	}
	return r, nil
}
func (s Store) MutateMaterial(ctx context.Context, tenant, skill, id, operation, actor string, input map[string]any) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	parent, err := get(ctx, tx, tenant, skill, true)
	if err != nil {
		if operation == "create" {
			return nil, err
		}
		name := "material"
		if operation == "delete" {
			name = "Material"
		}
		return nil, missing(name)
	}
	var r map[string]any
	now := stamp()
	action := "material_added"
	if operation == "create" {
		if !editable(parent) {
			return nil, fault.New(403, "READ_ONLY_SKILL", "Materials cannot be added to this skill.")
		}
		r, err = materialInput(nil, input, true)
		if err != nil {
			return nil, err
		}
		var n int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM skill_materials WHERE tenant_id=$1 AND skill_id=$2 AND document->>'archived_at' IS NULL`, tenant, skill).Scan(&n); err != nil {
			return nil, err
		}
		if n >= 10 {
			return nil, materialError("MATERIAL_LIMIT_REACHED", "A skill can have at most 10 active materials.")
		}
		id = "SM-" + jobs.ID()
		r["id"] = id
		r["tenant_id"] = tenant
		r["skill_id"] = skill
		r["created_by"] = actor
		r["created_at"] = now
		r["updated_at"] = now
		_, err = tx.Exec(ctx, `INSERT INTO skill_materials(tenant_id,skill_id,id,document) VALUES($1,$2,$3,$4)`, tenant, skill, id, r)
	} else {
		r, err = material(ctx, tx, tenant, skill, id)
		if err != nil || r["archived_at"] != nil {
			if operation == "delete" {
				return nil, missing("Material")
			}
			if err != nil {
				return nil, err
			}
			return nil, missing("material")
		}
		if operation == "delete" {
			r["archived_at"] = now
			action = "material_archived"
		} else {
			if !editable(parent) {
				return nil, fault.New(403, "READ_ONLY_SKILL", "This material cannot be edited.")
			}
			r, err = materialInput(r, input, false)
			if err != nil {
				return nil, err
			}
			r["version"] = r["version"].(float64) + 1
			action = "material_updated"
		}
		r["updated_at"] = now
		_, err = tx.Exec(ctx, `UPDATE skill_materials SET document=$4 WHERE tenant_id=$1 AND skill_id=$2 AND id=$3`, tenant, skill, id, r)
	}
	if err != nil {
		return nil, err
	}
	if operation != "delete" {
		snapshot := map[string]any{}
		for _, key := range []string{"name", "kind", "file_type", "source_url", "content"} {
			snapshot[key] = r[key]
		}
		_, err = tx.Exec(ctx, `INSERT INTO skill_material_versions(tenant_id,material_id,version,snapshot,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)`, tenant, id, int(r["version"].(float64)), snapshot, actor, now)
		if err != nil {
			return nil, err
		}
	}
	parent["version"] = parent["version"].(float64) + 1
	parent["updated_at"] = now
	if err = save(ctx, tx, parent, false); err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, tenant, skill, action, actor, map[string]any{"material_id": id, "material_version": r["version"]}); err != nil {
		return nil, err
	}
	return r, tx.Commit(ctx)
}
