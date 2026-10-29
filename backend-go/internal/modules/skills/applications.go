package skills

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
)

type Context struct {
	Module, Source, Title, Category              string
	SourceEntities, RuntimeEntities, InsightRefs []string
}

func stringsOf(v any) []string {
	a, ok := v.([]any)
	if !ok {
		if b, ok := v.([]string); ok {
			return b
		}
		return nil
	}
	r := []string{}
	for _, x := range a {
		r = append(r, fmt.Sprint(x))
	}
	return r
}
func lower(v []string) []string {
	r := []string{}
	for _, x := range v {
		r = append(r, strings.ToLower(x))
	}
	return r
}
func contains(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
func reasons(skill map[string]any, c Context, sources []string) []string {
	r := []string{"module: " + c.Module}
	modules := lower(stringsOf(skill["modules"]))
	if len(modules) > 0 && !contains(modules, strings.ToLower(c.Module)) {
		return nil
	}
	connectors := lower(stringsOf(skill["connectors"]))
	if len(connectors) > 0 {
		found := false
		for _, v := range connectors {
			if contains(sources, v) {
				found = true
			}
		}
		if !found {
			return nil
		}
		r = append(r, "connector: "+c.Source)
	}
	categories := lower(stringsOf(skill["alert_categories"]))
	if len(categories) > 0 {
		if c.Category == "" || !contains(categories, strings.ToLower(c.Category)) {
			return nil
		}
		r = append(r, "category: "+c.Category)
	}
	types := lower(stringsOf(skill["alert_types"]))
	if len(types) > 0 {
		found := ""
		for _, v := range types {
			if strings.Contains(strings.ToLower(c.Title), v) {
				found = v
				break
			}
		}
		if found == "" {
			return nil
		}
		r = append(r, "alert type: "+found)
	}
	for _, f := range []struct {
		field, label string
		values       []string
	}{{"source_entities", "source entity", c.SourceEntities}, {"runtime_entities", "runtime entity", c.RuntimeEntities}, {"insight_refs", "enterprise context", c.InsightRefs}} {
		scope := lower(stringsOf(skill[f.field]))
		if len(scope) == 0 {
			continue
		}
		values := lower(f.values)
		found := []string{}
		for _, v := range scope {
			if contains(values, v) {
				found = append(found, v)
			}
		}
		if len(found) == 0 {
			return nil
		}
		r = append(r, f.label+": "+strings.Join(found, ", "))
	}
	return r
}
func aliases(ctx context.Context, db DB, tenant, source string) ([]string, error) {
	if source == "" {
		return []string{}, nil
	}
	a := []string{source}
	if strings.HasPrefix(source, "api-source:") {
		var provider string
		err := db.QueryRow(ctx, `SELECT provider FROM api_sources WHERE tenant_id=$1 AND id=$2`, tenant, strings.TrimPrefix(source, "api-source:")).Scan(&provider)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		if provider != "" {
			a = append(a, provider)
		}
	}
	rows, err := db.Query(ctx, `SELECT document->>'name',document->>'type' FROM connectors WHERE tenant_id=$1 ORDER BY ordinal`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, typ string
		if err = rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		for _, v := range a {
			if strings.EqualFold(v, name) || strings.EqualFold(v, typ) {
				a = append(a, name, typ)
				break
			}
		}
	}
	return lower(a), rows.Err()
}

// Callers hold the target case/hunt lock before applying. Skill shared locks keep
// versions and active material snapshots stable against concurrent authoring.
func Apply(ctx context.Context, tx pgx.Tx, tenant, targetType, targetID string, c Context) ([]map[string]any, error) {
	rows, err := tx.Query(ctx, `SELECT document FROM skills WHERE tenant_id=$1 AND document->>'state'='published' AND document->'enabled'='true'::jsonb ORDER BY `+lowerName+` COLLATE "C",ordinal FOR SHARE`, tenant)
	if err != nil {
		return nil, err
	}
	active := []map[string]any{}
	for rows.Next() {
		var r map[string]any
		if err = rows.Scan(&r); err != nil {
			rows.Close()
			return nil, err
		}
		active = append(active, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	applied := []map[string]any{}
	// Resolve aliases only when connector-scoped skills need them, and reuse the
	// result within this application. No mutable data is cached across transactions.
	var sources []string
	aliasesLoaded := false
	for _, skill := range active {
		if !aliasesLoaded && len(stringsOf(skill["connectors"])) > 0 {
			sources, err = aliases(ctx, tx, tenant, c.Source)
			if err != nil {
				return nil, err
			}
			aliasesLoaded = true
		}
		why := reasons(skill, c, sources)
		if why == nil {
			continue
		}
		skillID := skill["id"].(string)
		version := int(skill["version"].(float64))
		var existing map[string]any
		err = tx.QueryRow(ctx, `SELECT document FROM skill_applications WHERE tenant_id=$1 AND skill_id=$2 AND target_type=$3 AND target_id=$4 AND skill_version=$5`, tenant, skillID, targetType, targetID, version).Scan(&existing)
		if err == nil {
			applied = append(applied, map[string]any{"id": existing["id"], "skill_id": skillID, "name": skill["name"], "version": version, "reason": existing["reason"], "already_applied": true})
			continue
		}
		if err != pgx.ErrNoRows {
			return nil, err
		}
		materials := []map[string]any{}
		rows, err = tx.Query(ctx, `SELECT document FROM skill_materials WHERE tenant_id=$1 AND skill_id=$2 AND document->>'archived_at' IS NULL ORDER BY `+lowerName+` COLLATE "C",ordinal`, tenant, skillID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var m map[string]any
			if err = rows.Scan(&m); err != nil {
				rows.Close()
				return nil, err
			}
			snapshot := map[string]any{}
			for _, key := range []string{"id", "name", "kind", "file_type", "source_url", "content", "version"} {
				snapshot[key] = m[key]
			}
			materials = append(materials, snapshot)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		snap := map[string]any{}
		for _, key := range []string{"id", "name", "skill_type", "version", "description", "apply_when", "content_markdown", "modules", "connectors", "alert_types", "alert_categories", "source_entities", "runtime_entities", "insight_refs"} {
			snap[key] = skill[key]
		}
		snap["materials"] = materials
		encoded, err := json.Marshal(snap)
		if err != nil {
			return nil, err
		}
		id := "SAP-" + jobs.ID()
		now := stamp()
		reason := "Matched " + strings.Join(why, "; ") + "."
		doc := map[string]any{"id": id, "tenant_id": tenant, "skill_id": skillID, "target_type": targetType, "target_id": targetID, "skill_version": version, "reason": reason, "snapshot_json": string(encoded), "created_at": now}
		if _, err = tx.Exec(ctx, `INSERT INTO skill_applications(tenant_id,id,skill_id,target_type,target_id,skill_version,document) VALUES($1,$2,$3,$4,$5,$6,$7)`, tenant, id, skillID, targetType, targetID, version, doc); err != nil {
			return nil, err
		}
		if targetType == "investigation" {
			step := map[string]any{"id": "STEP-" + id, "tenant_id": tenant, "investigation_id": targetID, "title": "Applied skill: " + skill["name"].(string), "conclusion": reason, "tool": "AISOC Skills", "request": map[string]any{"skill_id": skillID, "skill_version": version, "reason": reason, "instructions": skill["content_markdown"], "materials": materials, "enterprise_context": skill["insight_refs"]}, "response": map[string]any{"guidance_recorded": true, "automated_actions": false, "external_tools_executed": false}, "created_at": now, "updated_at": now}
			if _, err = tx.Exec(ctx, `INSERT INTO investigation_steps(tenant_id,id,investigation_id,document,created_at) VALUES($1,$2,$3,$4,$5)`, tenant, step["id"], targetID, step, now); err != nil {
				return nil, err
			}
			details := map[string]any{"application_id": id, "skill_id": skillID, "skill_version": version, "reason": reason}
			if _, err = tx.Exec(ctx, `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'investigations',$3,'skill_applied',$4,$5,$5)`, tenant, jobs.ID(), targetID, details, now); err != nil {
				return nil, err
			}
		}
		applied = append(applied, map[string]any{"id": id, "skill_id": skillID, "name": skill["name"], "version": version, "reason": reason})
	}
	return applied, nil
}
func Applications(ctx context.Context, db DB, tenant, targetType, id string) ([]map[string]any, error) {
	rows, err := db.Query(ctx, `SELECT document FROM skill_applications WHERE tenant_id=$1 AND target_type=$2 AND target_id=$3 ORDER BY document->>'created_at' DESC,ordinal DESC`, tenant, targetType, id)
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
	for _, r := range items {
		var snapshot any
		if err = json.Unmarshal([]byte(r["snapshot_json"].(string)), &snapshot); err != nil {
			return nil, err
		}
		r["snapshot"] = snapshot
		r["feedback"] = []map[string]any{}
		rows, err = db.Query(ctx, `SELECT document-'id'-'tenant_id'-'application_id' FROM skill_application_feedback WHERE tenant_id=$1 AND application_id=$2 ORDER BY document->>'updated_at' DESC,ordinal DESC`, tenant, r["id"])
		if err != nil {
			return nil, err
		}
		feedback := []map[string]any{}
		for rows.Next() {
			var f map[string]any
			if err = rows.Scan(&f); err != nil {
				rows.Close()
				return nil, err
			}
			feedback = append(feedback, f)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		r["feedback"] = feedback
	}
	return items, nil
}
func (s Store) Feedback(ctx context.Context, tenant, id, actor, rating, comment string) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var skill string
	if err = tx.QueryRow(ctx, `SELECT skill_id FROM skill_applications WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id).Scan(&skill); err != nil {
		if err == pgx.ErrNoRows {
			return nil, missing("Skill application")
		}
		return nil, err
	}
	if rating != "helpful" && rating != "not_helpful" {
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid feedback rating.")
	}
	now := stamp()
	comment = strings.TrimSpace(comment)
	doc := map[string]any{"id": jobs.ID(), "tenant_id": tenant, "application_id": id, "rating": rating, "comment": comment, "created_by": actor, "created_at": now, "updated_at": now}
	_, err = tx.Exec(ctx, `INSERT INTO skill_application_feedback(tenant_id,id,application_id,created_by,document) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,application_id,created_by) DO UPDATE SET document=skill_application_feedback.document || jsonb_build_object('rating',EXCLUDED.document->'rating','comment',EXCLUDED.document->'comment','updated_at',EXCLUDED.document->'updated_at')`, tenant, doc["id"], id, actor, doc)
	if err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, tenant, skill, "application_feedback_received", actor, map[string]any{"application_id": id, "rating": rating}); err != nil {
		return nil, err
	}
	return map[string]any{"application_id": id, "rating": rating, "comment": comment, "updated_at": now}, tx.Commit(ctx)
}
