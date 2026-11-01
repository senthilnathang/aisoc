package learning

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

type LifecycleInput struct {
	Operation             string `json:"operation"`
	ExpectedVersion       int    `json:"expected_version"`
	ExpectedSourceVersion string `json:"expected_source_version"`
	Confirm               bool   `json:"confirm"`
	Rationale             string `json:"rationale"`
}

func lifecycleDoc(ctx context.Context, q *investigationsql.Queries, tenant, kind, id string, lock bool) (map[string]any, error) {
	var raw []byte
	var err error
	switch kind {
	case "skills":
		if lock {
			raw, err = q.LockLifecycleSkill(ctx, investigationsql.LockLifecycleSkillParams{TenantID: tenant, ID: id})
		} else {
			raw, err = q.LifecycleSkill(ctx, investigationsql.LifecycleSkillParams{TenantID: tenant, ID: id})
		}
	case "enterprise-insights":
		if lock {
			raw, err = q.LockLifecycleInsight(ctx, investigationsql.LockLifecycleInsightParams{TenantID: tenant, ID: id})
		} else {
			raw, err = q.LifecycleInsight(ctx, investigationsql.LifecycleInsightParams{TenantID: tenant, ID: id})
		}
	default:
		return nil, fault.New(404, "NOT_FOUND", "Unknown resource.")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Guidance not found.")
	}
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	err = json.Unmarshal(raw, &doc)
	return doc, err
}
func originSource(doc map[string]any) map[string]any {
	origin, _ := doc["learning_origin"].(map[string]any)
	src, _ := origin["source_case"].(map[string]any)
	return src
}
func (s Store) Lifecycle(ctx context.Context, tenant, kind, id string) (map[string]any, error) {
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := investigationsql.New(tx)
	doc, e := lifecycleDoc(ctx, q, tenant, kind, id, false)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(doc)
	current, e := q.LifecycleCurrent(ctx, investigationsql.LifecycleCurrentParams{TenantID: tenant, Document: raw})
	if e != nil {
		return nil, e
	}
	out := map[string]any{"version": doc["version"], "current": current, "archived": doc["archived"] == true || doc["learning_archived"] == true, "source": nil, "approved_source": originSource(doc), "review": doc["learning_review"], "staged_edit": doc["staged_edit"], "materials_staged": doc["materials_staged"]}
	if src := originSource(doc); src != nil {
		row, err := q.LearningCase(ctx, investigationsql.LearningCaseParams{TenantID: tenant, ID: src["id"].(string)})
		if err == nil {
			out["source"] = source(row)
			out["source_eligible"] = eligible(row)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return out, tx.Commit(ctx)
}
func (s Store) ReviewLifecycle(ctx context.Context, tenant, actor, kind, id string, in LifecycleInput) (map[string]any, error) {
	if !in.Confirm || in.ExpectedVersion < 1 || !textOK(in.Rationale, 10, 2000) {
		return nil, invalid()
	}
	switch in.Operation {
	case "reapprove", "archive", "publish-staged", "discard-staged":
	default:
		return nil, invalid()
	}
	if kind != "skills" && (in.Operation == "publish-staged" || in.Operation == "discard-staged") {
		return nil, invalid()
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := investigationsql.New(tx)
	initial, e := lifecycleDoc(ctx, q, tenant, kind, id, false)
	if e != nil {
		return nil, e
	}
	var src map[string]any
	// Match original approval's lock order: source case before owning resource.
	if origin := originSource(initial); origin != nil {
		row, err := q.LearningCase(ctx, investigationsql.LearningCaseParams{TenantID: tenant, ID: origin["id"].(string)})
		if err == nil {
			src = source(row)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	doc, e := lifecycleDoc(ctx, q, tenant, kind, id, true)
	if e != nil {
		return nil, e
	}
	if kind == "skills" && doc["origin"] != "user" && doc["origin"] != "environment_generated" {
		return nil, fault.New(403, "READ_ONLY_SKILL", "This skill cannot be changed.")
	}
	if doc["version"] != float64(in.ExpectedVersion) {
		return nil, fault.New(409, "GUIDANCE_CHANGED", "Guidance changed; refresh before reviewing.")
	}
	if doc["archived"] == true || doc["learning_archived"] == true {
		return nil, fault.New(409, "GUIDANCE_ARCHIVED", "Archived guidance cannot be reactivated. Capture new reviewed guidance instead.")
	}
	raw, _ := json.Marshal(doc)
	current, e := q.LifecycleCurrent(ctx, investigationsql.LifecycleCurrentParams{TenantID: tenant, Document: raw})
	if e != nil {
		return nil, e
	}
	switch in.Operation {
	case "reapprove":
		origin := originSource(doc)
		if src == nil || origin == nil || src["updated_at"] != in.ExpectedSourceVersion {
			return nil, fault.New(409, "SOURCE_CHANGED", "Refresh and review the current source investigation.")
		}
		if (src["status"] != "resolved" && src["status"] != "closed") || src["determination"] == "unknown" || src["primary_entity"] != origin["primary_entity"] {
			return nil, fault.New(409, "SOURCE_NOT_ELIGIBLE", "Resolve the source with a reviewed outcome and unchanged entity, or capture new scoped guidance.")
		}
		if kind == "enterprise-insights" && doc["valid_until"] != nil {
			until, _ := time.Parse(time.RFC3339Nano, doc["valid_until"].(string))
			if !until.After(time.Now()) {
				return nil, fault.New(409, "MEMORY_EXPIRED", "Review and update the expiry before reapproval.")
			}
		}
		doc["learning_review"] = map[string]any{"source_version": src["updated_at"], "source_case": src, "actor": actor, "rationale": in.Rationale, "reviewed_at": time.Now().UTC().Format(time.RFC3339Nano)}
	case "archive":
		doc["learning_archived"] = true
		doc["enabled"] = false
	case "publish-staged":
		draft, ok := doc["staged_edit"].(map[string]any)
		if !ok || !current {
			return nil, fault.New(409, "REVIEW_REQUIRED", "Save a staged edit and reapprove changed source guidance before publication.")
		}
		for k, v := range draft {
			doc[k] = v
		}
		delete(doc, "staged_edit")
		if doc["materials_staged"] == true {
			release, e := skills.CaptureMaterialsTx(ctx, tx, tenant, id)
			if e != nil {
				return nil, e
			}
			doc["published_materials"] = release
			delete(doc, "materials_staged")
		}
		doc["published_version"] = float64(in.ExpectedVersion + 1)
	case "discard-staged":
		if doc["staged_edit"] == nil {
			return nil, fault.New(409, "NO_STAGED_EDIT", "No staged edit to discard.")
		}
		delete(doc, "staged_edit")
		if doc["materials_staged"] == true {
			release, _ := doc["published_materials"].([]any)
			if e := skills.RestoreMaterialsTx(ctx, tx, tenant, id, actor, release); e != nil {
				return nil, e
			}
			delete(doc, "materials_staged")
		}
	}
	doc["version"] = float64(in.ExpectedVersion + 1)
	doc["updated_at"] = investigations.Timestamp(time.Now())
	if kind == "skills" {
		if in.Operation == "reapprove" && doc["state"] == "published" {
			doc["published_version"] = doc["version"]
		}
		raw, _ = json.Marshal(doc)
		e = q.SaveLifecycleSkill(ctx, investigationsql.SaveLifecycleSkillParams{TenantID: tenant, ID: id, Document: raw})
	} else {
		raw, _ = json.Marshal(doc)
		e = q.SaveLifecycleInsight(ctx, investigationsql.SaveLifecycleInsightParams{TenantID: tenant, ID: id, Document: raw, Archived: in.Operation == "archive"})
	}
	if e != nil {
		return nil, e
	}
	resource := kind
	if kind == "skills" {
		resource = "skill"
	}
	e = investigations.ResourceAudit(ctx, tx, tenant, resource, id, "lifecycle_"+in.Operation, map[string]any{"actor": actor, "rationale": in.Rationale, "version": doc["version"], "source_version": in.ExpectedSourceVersion})
	if e != nil {
		return nil, e
	}
	return doc, tx.Commit(ctx)
}
