package skills

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"unicode/utf16"
)

func suggestionShape(r map[string]any) (map[string]any, error) {
	for _, key := range []string{"sample_case_ids", "draft"} {
		var v any
		if err := json.Unmarshal([]byte(r[key+"_json"].(string)), &v); err != nil {
			return nil, err
		}
		r[key] = v
	}
	return r, nil
}
func (s Store) Suggestions(ctx context.Context, tenant, status string) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Serialize refresh/accept/dismiss for a tenant, including absent signatures.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "skill-suggestions:"+tenant); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT COALESCE(src.provider,a.source),COALESCE(NULLIF(i.category,''),'other'),count(DISTINCT i.id),count(DISTINCT f.id)
 FROM alerts a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id
 LEFT JOIN api_sources src ON src.tenant_id=a.tenant_id AND a.source='api-source:'||src.id
 LEFT JOIN case_records f ON f.tenant_id=i.tenant_id AND f.investigation_id=i.id AND f.kind='feedback'
 WHERE i.tenant_id=$1 AND i.status IN ('closed','resolved') AND i.determination IN ('benign','suspicious','malicious','mitigated')
 GROUP BY COALESCE(src.provider,a.source),COALESCE(NULLIF(i.category,''),'other') HAVING count(DISTINCT i.id)>=2`, tenant)
	if err != nil {
		return nil, err
	}
	type pattern struct {
		source, category string
		cases, feedback  int
	}
	patterns := []pattern{}
	for rows.Next() {
		var p pattern
		if err = rows.Scan(&p.source, &p.category, &p.cases, &p.feedback); err != nil {
			rows.Close()
			return nil, err
		}
		patterns = append(patterns, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, p := range patterns {
		rows, err = tx.Query(ctx, `SELECT DISTINCT i.id,i.updated_at,i.insight_refs FROM alerts a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id LEFT JOIN api_sources src ON src.tenant_id=a.tenant_id AND a.source='api-source:'||src.id WHERE i.tenant_id=$1 AND COALESCE(src.provider,a.source)=$2 AND COALESCE(NULLIF(i.category,''),'other')=$3 AND i.status IN ('closed','resolved') AND i.determination IN ('benign','suspicious','malicious','mitigated') ORDER BY i.updated_at DESC,i.id LIMIT 10`, tenant, p.source, p.category)
		if err != nil {
			return nil, err
		}
		ids := []string{}
		common := []string{}
		for rows.Next() {
			var id string
			var updated any
			var refs []string
			if err = rows.Scan(&id, &updated, &refs); err != nil {
				rows.Close()
				return nil, err
			}
			if len(ids) == 0 {
				common = refs
			} else {
				next := []string{}
				for _, v := range common {
					if contains(refs, v) {
						next = append(next, v)
					}
				}
				common = next
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		name := "Review " + p.category + " alerts from " + p.source
		units := utf16.Encode([]rune(name))
		if len(units) > 200 {
			name = string(utf16.Decode(units[:200]))
		}
		explanation := fmt.Sprintf("Pattern candidate from %d closed or resolved investigations with analyst determinations", p.cases)
		if p.feedback > 0 {
			explanation += fmt.Sprintf(" and %d analyst notes", p.feedback)
		}
		explanation += ". This is a deterministic draft from workspace records, not an AI conclusion or measured effectiveness claim."
		draft := map[string]any{"name": name, "skill_type": "strategy", "description": fmt.Sprintf("A starting workflow based on %d reviewed %s cases from %s. Verify each conclusion against current evidence.", p.cases, p.category, p.source), "apply_when": "When an investigation is categorized as " + p.category + " and comes from " + p.source + ".", "content_markdown": fmt.Sprintf("## Suggested review\n1. Compare the current evidence with the case context and source details.\n2. Review the supplied artifacts and investigation history.\n3. Record an evidence-backed determination; keep uncertainty explicit.\n4. Require analyst approval for containment or other response actions.\n\nGenerated from %d closed or resolved workspace cases. Review and edit these steps before publishing.", p.cases), "modules": []string{"investigations"}, "connectors": []string{p.source}, "alert_categories": []string{p.category}, "insight_refs": common, "tags": []string{strings.ToLower(p.category), strings.ToLower(p.source)}}
		draftJSON, _ := json.Marshal(draft)
		samplesJSON, _ := json.Marshal(ids)
		now := stamp()
		signature := strings.ToLower(p.source) + "|" + strings.ToLower(p.category)
		id := "SG-" + jobs.ID()
		doc := map[string]any{"id": id, "tenant_id": tenant, "signature": signature, "name": name, "explanation": explanation, "source": p.source, "category": p.category, "case_count": p.cases, "feedback_count": p.feedback, "sample_case_ids_json": string(samplesJSON), "draft_json": string(draftJSON), "status": "pending", "accepted_skill_id": nil, "created_at": now, "updated_at": now}
		_, err = tx.Exec(ctx, `INSERT INTO skill_suggestions(tenant_id,id,signature,document) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,signature) DO UPDATE SET document=skill_suggestions.document || (EXCLUDED.document-'id'-'tenant_id'-'signature'-'source'-'category'-'status'-'accepted_skill_id'-'created_at') WHERE skill_suggestions.document->>'status'='pending'`, tenant, id, signature, doc)
		if err != nil {
			return nil, err
		}
	}
	rows, err = tx.Query(ctx, `SELECT document FROM skill_suggestions WHERE tenant_id=$1 AND document->>'status'=$2 ORDER BY (document->>'case_count')::int DESC,document->>'updated_at' DESC,ordinal`, tenant, status)
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
		r, err = suggestionShape(r)
		if err != nil {
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
	return map[string]any{"items": items, "generated_from": "repeated closed/resolved cases with analyst determinations", "minimum_cases": 2}, tx.Commit(ctx)
}
func (s Store) ReviewSuggestion(ctx context.Context, tenant, id, operation, actor string) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "skill-suggestions:"+tenant); err != nil {
		return nil, err
	}
	var r map[string]any
	err = tx.QueryRow(ctx, `SELECT document FROM skill_suggestions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id).Scan(&r)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, missing("suggestion")
		}
		return nil, err
	}
	if operation == "accept" && r["status"] == "accepted" && r["accepted_skill_id"] != nil {
		skill, e := get(ctx, tx, tenant, r["accepted_skill_id"].(string), false)
		if e != nil {
			if f, ok := e.(*fault.Error); !ok || f.Status != 404 {
				return nil, e
			}
			skill = nil
		}
		shaped, e := suggestionShape(r)
		if e != nil {
			return nil, e
		}
		result := map[string]any{"suggestion": shaped}
		if skill != nil {
			result["skill"] = skill
		}
		return result, tx.Commit(ctx)
	}
	if r["status"] != "pending" {
		message := "Only pending suggestions can be dismissed."
		if operation == "accept" {
			message = "This suggestion has already been dismissed."
		}
		return nil, fault.New(409, "SUGGESTION_NOT_PENDING", message)
	}
	now := stamp()
	var skill map[string]any
	if operation == "accept" {
		var draft map[string]any
		if err = json.Unmarshal([]byte(r["draft_json"].(string)), &draft); err != nil {
			return nil, err
		}
		skillID := "SK-" + jobs.ID()
		skill = map[string]any{"id": skillID, "tenant_id": tenant, "skill_type": "strategy", "description": "", "apply_when": "", "content_markdown": "", "origin": "environment_generated", "state": "draft", "enabled": false, "version": float64(1), "created_by": actor, "created_at": now, "updated_at": now}
		for _, key := range Arrays {
			skill[key] = []any{}
		}
		for k, v := range draft {
			skill[k] = v
		}
		if err = save(ctx, tx, skill, true); err != nil {
			return nil, err
		}
		if err = audit(ctx, tx, tenant, skillID, "created", actor, map[string]any{"origin": "environment_generated", "suggestion_id": id}); err != nil {
			return nil, err
		}
		if err = audit(ctx, tx, tenant, skillID, "created_from_suggestion", actor, map[string]any{"suggestion_id": id, "case_count": r["case_count"]}); err != nil {
			return nil, err
		}
		r["status"] = "accepted"
		r["accepted_skill_id"] = skillID
	} else {
		r["status"] = "dismissed"
		if err = audit(ctx, tx, tenant, id, "suggestion_dismissed", actor, nil); err != nil {
			return nil, err
		}
	}
	r["updated_at"] = now
	if _, err = tx.Exec(ctx, `UPDATE skill_suggestions SET document=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, r); err != nil {
		return nil, err
	}
	r, err = suggestionShape(r)
	if err != nil {
		return nil, err
	}
	var result map[string]any = r
	if operation == "accept" {
		result = map[string]any{"suggestion": r, "skill": skill}
	}
	return result, tx.Commit(ctx)
}
