// Package learning connects reviewed outcomes to existing Skills and Memory stores.
// It never invokes inference, changes determinations or grants response privileges.
package learning

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Store struct{ Pool *pgxpool.Pool }
type Input struct {
	ExpectedUpdatedAt string   `json:"expected_updated_at"`
	EvidenceIDs       []string `json:"evidence_ids"`
	Confirm           bool     `json:"confirm"`
	Rationale         string   `json:"rationale"`
	CreateSkill       bool     `json:"create_skill"`
	Name              string   `json:"name"`
	Guidance          string   `json:"guidance"`
	CreateMemory      bool     `json:"create_memory"`
	MemoryKind        string   `json:"memory_kind"`
	Context           string   `json:"context"`
	ValidUntil        string   `json:"valid_until"`
}

func textOK(s string, min, max int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	return n >= min && n <= max && !strings.ContainsRune(s, 0)
}
func invalid() error {
	return fault.New(400, "INVALID_LEARNING", "Confirm reviewed evidence and save bounded guidance for independent approval.")
}
func validate(in Input) error {
	if !in.Confirm || !textOK(in.Rationale, 10, 2000) || (!in.CreateSkill && !in.CreateMemory) || len(in.EvidenceIDs) < 1 || len(in.EvidenceIDs) > 10 {
		return invalid()
	}
	if _, e := time.Parse(time.RFC3339Nano, in.ExpectedUpdatedAt); e != nil {
		return invalid()
	}
	seen := map[string]bool{}
	for _, id := range in.EvidenceIDs {
		if !textOK(id, 1, 200) || seen[id] {
			return invalid()
		}
		seen[id] = true
	}
	if in.CreateSkill {
		if !textOK(in.Name, 1, 200) || !textOK(in.Guidance, 10, 8000) {
			return invalid()
		}
	} else if in.Name != "" || in.Guidance != "" {
		return invalid()
	}
	if in.CreateMemory {
		if !textOK(in.Context, 10, 8000) {
			return invalid()
		}
		switch in.MemoryKind {
		case "user", "network", "software", "other":
		default:
			return invalid()
		}
		if _, e := time.Parse(time.RFC3339, in.ValidUntil); e != nil {
			return invalid()
		}
	} else if in.Context != "" || in.MemoryKind != "" || in.ValidUntil != "" {
		return invalid()
	}
	return nil
}
func eligible(r investigationsql.LearningCaseRow) bool {
	return (r.Status == "closed" || r.Status == "resolved") && (r.Determination == "benign" || r.Determination == "suspicious" || r.Determination == "malicious" || r.Determination == "mitigated")
}
func source(r investigationsql.LearningCaseRow) map[string]any {
	return map[string]any{"id": r.ID, "title": r.Title, "status": r.Status, "determination": r.Determination, "primary_entity": r.PrimaryEntity, "source": r.Source, "category": r.Category, "updated_at": investigations.Timestamp(r.UpdatedAt.Time)}
}
func evidence(id string, raw []byte) (map[string]any, error) {
	var d map[string]any
	if e := json.Unmarshal(raw, &d); e != nil {
		return nil, e
	}
	out := map[string]any{"id": id}
	for k, max := range map[string]int{"label": 200, "type": 100, "value": 2000} {
		s, _ := d[k].(string)
		r := []rune(s)
		if len(r) > max {
			s = string(r[:max]) + "…"
		}
		out[k] = s
	}
	hash := sha256.Sum256(raw)
	out["content_hash"] = hex.EncodeToString(hash[:])
	return out, nil
}
func (s Store) Workspace(ctx context.Context, tenant, id string) (map[string]any, error) {
	q := investigationsql.New(s.Pool)
	r, e := q.LearningCase(ctx, investigationsql.LearningCaseParams{TenantID: tenant, ID: id})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Investigation not found.")
	}
	if e != nil {
		return nil, e
	}
	rows, e := q.LearningArtifacts(ctx, investigationsql.LearningArtifactsParams{TenantID: tenant, InvestigationID: id})
	if e != nil {
		return nil, e
	}
	artifacts := []map[string]any{}
	for _, a := range rows {
		v, e := evidence(a.ID, a.Document)
		if e != nil {
			return nil, e
		}
		artifacts = append(artifacts, v)
	}
	rows2, e := q.LearningReceipts(ctx, investigationsql.LearningReceiptsParams{TenantID: tenant, InvestigationID: id})
	if e != nil {
		return nil, e
	}
	receipts := []json.RawMessage{}
	for _, r := range rows2 {
		receipts = append(receipts, r)
	}
	return map[string]any{"case": source(r), "eligible": eligible(r), "artifacts": artifacts, "receipts": receipts}, nil
}
func (s Store) Propose(ctx context.Context, tenant, id, actor string, in Input) (map[string]any, error) {
	if e := validate(in); e != nil {
		return nil, e
	}
	// Canonicalize selected evidence ordering and the case revision for stable retries.
	in.EvidenceIDs = append([]string{}, in.EvidenceIDs...)
	sort.Strings(in.EvidenceIDs)
	at, _ := time.Parse(time.RFC3339Nano, in.ExpectedUpdatedAt)
	in.ExpectedUpdatedAt = investigations.Timestamp(at)
	encoded, _ := json.Marshal(in)
	h := sha256.Sum256(encoded)
	hash := hex.EncodeToString(h[:])
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := investigationsql.New(tx)
	r, e := q.LearningCase(ctx, investigationsql.LearningCaseParams{TenantID: tenant, ID: id})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Investigation not found.")
	}
	if e != nil {
		return nil, e
	}
	prior, e := q.LearningReceipt(ctx, investigationsql.LearningReceiptParams{TenantID: tenant, InvestigationID: id, SourceVersion: in.ExpectedUpdatedAt})
	if e == nil {
		if prior.RequestHash != hash {
			return nil, fault.New(409, "LEARNING_CONFLICT", "This case revision already has approved learning. Review its receipt before creating another version.")
		}
		var receipt map[string]any
		e = json.Unmarshal(prior.Document, &receipt)
		return receipt, e
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	if investigations.Timestamp(r.UpdatedAt.Time) != in.ExpectedUpdatedAt {
		return nil, fault.New(409, "CASE_CHANGED", "The case changed. Refresh and review its current outcome before approving.")
	}
	if !eligible(r) {
		return nil, fault.New(409, "OUTCOME_NOT_REVIEWED", "Resolve or close the case with a reviewed determination before capturing learning.")
	}
	// Scope both outputs to an actual entity from the case, never a caller-supplied tenant or target.
	if !textOK(r.PrimaryEntity, 1, 200) {
		return nil, fault.New(409, "ENTITY_REQUIRED", "A case primary entity of at most 200 characters is required for scoped learning.")
	}
	if in.CreateMemory {
		until, _ := time.Parse(time.RFC3339, in.ValidUntil)
		now := time.Now()
		if !until.After(now) || until.After(now.AddDate(1, 0, 0)) {
			return nil, fault.New(400, "INVALID_EXPIRY", "Memory expiry must be in the future and within one year.")
		}
	}
	selected := []map[string]any{}
	for _, eid := range in.EvidenceIDs {
		raw, e := q.LearningEvidence(ctx, investigationsql.LearningEvidenceParams{TenantID: tenant, InvestigationID: id, ID: eid})
		if errors.Is(e, pgx.ErrNoRows) {
			return nil, fault.New(400, "INVALID_EVIDENCE", "Select artifacts stored in this investigation.")
		}
		if e != nil {
			return nil, e
		}
		v, e := evidence(eid, raw)
		if e != nil {
			return nil, e
		}
		selected = append(selected, v)
	}
	receipt := map[string]any{"source_case": source(r), "evidence": selected, "proposed_by": actor, "proposed_at": time.Now().UTC().Format(time.RFC3339Nano), "rationale": strings.TrimSpace(in.Rationale), "mode": "local-proposal", "skill_id": "", "insight_id": ""}
	if in.CreateMemory {
		m, e := insights.SaveTx(ctx, tx, tenant, actor, "", insights.Input{ID: "EI-" + jobs.ID(), Artifact: r.PrimaryEntity, Kind: in.MemoryKind, Content: in.Context, Hint: "none", ValidUntil: in.ValidUntil}, false)
		if e != nil {
			return nil, e
		}
		receipt["insight_id"] = m["id"]
		receipt["context"] = in.Context
		receipt["valid_until"] = in.ValidUntil
	}
	if in.CreateSkill {
		// Reuse existing skill validation and disabled draft creation. No implicit publication.
		input := map[string]any{"name": in.Name, "description": "Analyst-authored guidance from a reviewed investigation outcome.", "content_markdown": in.Guidance, "modules": []string{"investigations"}, "source_entities": []string{r.PrimaryEntity}, "tags": []string{"reviewed-outcome"}}
		sk, e := skills.MutateTx(ctx, tx, tenant, "", "create", actor, input)
		if e != nil {
			return nil, e
		}
		receipt["skill_id"] = sk["id"]
		receipt["guidance"] = in.Guidance
		receipt["name"] = in.Name
	}
	document, _ := json.Marshal(receipt)
	if sid := receipt["skill_id"].(string); sid != "" {
		if e = q.AttachSkillLearning(ctx, investigationsql.AttachSkillLearningParams{TenantID: tenant, ID: sid, Provenance: document}); e != nil {
			return nil, e
		}
	}
	if mid := receipt["insight_id"].(string); mid != "" {
		if e = q.AttachInsightLearning(ctx, investigationsql.AttachInsightLearningParams{TenantID: tenant, ID: mid, Provenance: document}); e != nil {
			return nil, e
		}
	}
	if e = q.InsertLearning(ctx, investigationsql.InsertLearningParams{TenantID: tenant, InvestigationID: id, SourceVersion: in.ExpectedUpdatedAt, RequestHash: hash, Document: document}); e != nil {
		return nil, e
	}
	if e = investigations.ResourceAudit(ctx, tx, tenant, "investigations", id, "learning_proposed", receipt); e != nil {
		return nil, e
	}
	return receipt, tx.Commit(ctx)
}
