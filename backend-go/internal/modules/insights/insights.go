package insights

import (
	"aisoc/backend/internal/modules/insights/insightsql"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Store struct{ Pool *pgxpool.Pool }
type Input struct {
	ID              string `json:"id"`
	Artifact        string `json:"artifact"`
	Kind            string `json:"kind"`
	Content         string `json:"content"`
	Hint            string `json:"hint"`
	ValidFrom       string `json:"valid_from"`
	ValidUntil      string `json:"valid_until"`
	FromPrevalence  bool   `json:"from_prevalence"`
	ExpectedVersion int32  `json:"expected_version"`
}

func invalid() error {
	return fault.New(400, "INVALID_INSIGHT", "Invalid insight fields or validity range.")
}
func key(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
func validate(in Input) (pgtype.Timestamptz, pgtype.Timestamptz, error) {
	var start, end pgtype.Timestamptz
	if strings.TrimSpace(in.Artifact) == "" || utf8.RuneCountInString(in.Artifact) > 300 || strings.TrimSpace(in.Content) == "" || utf8.RuneCountInString(in.Content) > 8000 || strings.ContainsRune(in.Artifact+in.Content, 0) {
		return start, end, invalid()
	}
	switch in.Kind {
	case "user", "network", "software", "other":
	default:
		return start, end, invalid()
	}
	switch in.Hint {
	case "", "none", "benign", "suspicious", "malicious":
	default:
		return start, end, invalid()
	}
	for _, x := range []struct {
		value  string
		target *pgtype.Timestamptz
	}{{in.ValidFrom, &start}, {in.ValidUntil, &end}} {
		if x.value != "" {
			t, err := time.Parse(time.RFC3339, x.value)
			if err != nil {
				return start, end, invalid()
			}
			*x.target = pgtype.Timestamptz{Time: t.UTC(), Valid: true}
		}
	}
	if start.Valid && end.Valid && !end.Time.After(start.Time) {
		return start, end, invalid()
	}
	return start, end, nil
}
func decode(raw []byte) (map[string]any, error) {
	var m map[string]any
	err := json.Unmarshal(raw, &m)
	return m, err
}
func record(r insightsql.EnterpriseInsight) (map[string]any, error) {
	m, err := decode(r.Document)
	if err != nil {
		return nil, err
	}
	delete(m, "request_hash")
	m["id"] = r.ID
	m["version"] = r.Version
	m["archived"] = r.Archived
	m["valid_from"] = r.ValidFrom
	m["valid_until"] = r.ValidUntil
	m["created_at"] = r.CreatedAt
	m["updated_at"] = r.UpdatedAt
	return m, nil
}

var idPattern = regexp.MustCompile(`^EI-[A-Za-z0-9-]{8,80}$`)

func (s Store) Save(ctx context.Context, tenant, actor, id string, in Input, archive bool) (map[string]any, error) {
	if !archive {
		if _, _, err := validate(in); err != nil {
			return nil, err
		}
	}
	if (id == "" && !idPattern.MatchString(in.ID)) || (id != "" && in.ExpectedVersion < 1) {
		return nil, invalid()
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	result, err := SaveTx(ctx, tx, tenant, actor, id, in, archive)
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

// SaveTx preserves validation, revisions and audit under a caller-owned transaction.
func SaveTx(ctx context.Context, tx pgx.Tx, tenant, actor, id string, in Input, archive bool) (map[string]any, error) {
	create := id == ""
	var start, end pgtype.Timestamptz
	var err error
	if !archive {
		start, end, err = validate(in)
		if err != nil {
			return nil, err
		}
	}
	if create {
		id = in.ID
		if !idPattern.MatchString(id) {
			return nil, invalid()
		}
	} else if in.ExpectedVersion < 1 {
		return nil, invalid()
	}
	q := insightsql.New(tx)
	if err = q.EnsureTenant(ctx, tenant); err != nil {
		return nil, err
	}
	if err = q.LockTenant(ctx, "enterprise-insights:"+tenant); err != nil {
		return nil, err
	}
	old, getErr := q.GetInsight(ctx, insightsql.GetInsightParams{TenantID: tenant, ID: id})
	doc := map[string]any{}
	action := "created"
	raw, _ := json.Marshal(in)
	hash := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(hash[:])
	if create {
		if getErr == nil {
			d, e := decode(old.Document)
			if e != nil {
				return nil, e
			}
			if d["request_hash"] == fingerprint && d["created_by"] == actor {
				return record(old)
			}
			return nil, fault.New(409, "INSIGHT_CONFLICT", "This request ID has already been used.")
		}
		if !errors.Is(getErr, pgx.ErrNoRows) {
			return nil, getErr
		}
		doc["origin"] = "analyst"
		doc["created_by"] = actor
		doc["request_hash"] = fingerprint
		if in.FromPrevalence {
			n, e := q.ReviewedCount(ctx, insightsql.ReviewedCountParams{TenantID: tenant, PrimaryEntity: key(in.Artifact)})
			if e != nil {
				return nil, e
			}
			if n < 2 {
				return nil, fault.New(409, "INSUFFICIENT_EVIDENCE", "At least two reviewed cases are required.")
			}
			exists, e := q.ExistingArtifact(ctx, insightsql.ExistingArtifactParams{TenantID: tenant, ArtifactKey: key(in.Artifact)})
			if e != nil {
				return nil, e
			}
			if exists > 0 {
				return nil, fault.New(409, "INSIGHT_EXISTS", "This artifact already has an insight.")
			}
			doc["origin"] = "prevalence_reviewed"
			doc["reviewed_cases_at_creation"] = n
		}
	} else {
		if errors.Is(getErr, pgx.ErrNoRows) {
			return nil, fault.New(404, "NOT_FOUND", "Insight not found.")
		}
		if getErr != nil {
			return nil, getErr
		}
		if old.Version != in.ExpectedVersion {
			return nil, fault.New(409, "INSIGHT_CONFLICT", "This insight changed. Reload before saving.")
		}
		if old.Archived {
			return nil, fault.New(409, "INSIGHT_ARCHIVED", "This insight is archived.")
		}
		doc, err = decode(old.Document)
		if err != nil {
			return nil, err
		}
		action = "updated"
	}
	if archive {
		action = "archived"
		start, end = old.ValidFrom, old.ValidUntil
	} else {
		doc["artifact"] = strings.TrimSpace(in.Artifact)
		doc["kind"] = in.Kind
		doc["content"] = strings.TrimSpace(in.Content)
		doc["hint"] = in.Hint
		if in.Hint == "" {
			doc["hint"] = "none"
		}
	}
	if !archive {
		doc["approval_state"] = "pending"
		delete(doc, "approval")
		auth.RecordProposer(doc, actor)
	}
	encoded, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	artifact := key(doc["artifact"].(string))
	if create {
		err = q.InsertInsight(ctx, insightsql.InsertInsightParams{TenantID: tenant, ID: id, Document: encoded, ArtifactKey: artifact, ValidFrom: start, ValidUntil: end})
	} else {
		err = q.UpdateInsight(ctx, insightsql.UpdateInsightParams{TenantID: tenant, ID: id, Document: encoded, ArtifactKey: artifact, ValidFrom: start, ValidUntil: end, Archived: archive})
	}
	if err != nil {
		return nil, err
	}
	details, _ := json.Marshal(map[string]any{"actor": actor, "artifact": doc["artifact"], "origin": doc["origin"]})
	if err = q.InsightAudit(ctx, insightsql.InsightAuditParams{TenantID: tenant, ID: jobs.ID(), ResourceID: id, Action: action, Details: details}); err != nil {
		return nil, err
	}
	saved, err := q.GetInsight(ctx, insightsql.GetInsightParams{TenantID: tenant, ID: id})
	if err != nil {
		return nil, err
	}
	result, err := record(saved)
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (s Store) Workspace(ctx context.Context, tenant, tab, search string, limit, offset int) (map[string]any, error) {
	if limit < 1 || limit > 100 || offset < 0 || offset > 1000000 || utf8.RuneCountInString(search) > 200 || strings.ContainsRune(search, 0) {
		return nil, invalid()
	}
	switch tab {
	case "active", "generated", "prevalence", "ai", "audit":
	default:
		return nil, invalid()
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := insightsql.New(tx)
	raw, err := q.Summary(ctx, tenant)
	if err != nil {
		return nil, err
	}
	summary, err := decode(raw)
	if err != nil {
		return nil, err
	}
	switch tab {
	case "active":
		raw, err = q.Registry(ctx, insightsql.RegistryParams{TenantID: tenant, Search: search, PageLimit: int32(limit), PageOffset: int32(offset)})
	case "generated", "prevalence":
		raw, err = q.ContextCards(ctx, insightsql.ContextCardsParams{TenantID: tenant, Search: search, Reviewed: tab == "prevalence", PageLimit: int32(limit), PageOffset: int32(offset)})
	case "audit":
		raw, err = q.Journal(ctx, insightsql.JournalParams{TenantID: tenant, Search: search, PageLimit: int32(limit), PageOffset: int32(offset)})
	case "ai":
		raw = []byte(`{"items":[],"total":0}`)
	}
	if err != nil {
		return nil, err
	}
	result, err := decode(raw)
	if err != nil {
		return nil, err
	}
	result["summary"] = summary
	result["limit"] = limit
	result["offset"] = offset
	return result, tx.Commit(ctx)
}
func (s Store) Uses(ctx context.Context, tenant, id string) (map[string]any, error) {
	raw, err := insightsql.New(s.Pool).Uses(ctx, insightsql.UsesParams{TenantID: tenant, InsightID: id})
	if err != nil {
		return nil, err
	}
	result, err := decode(raw)
	if err != nil {
		return nil, err
	}
	huntRaw, err := insightsql.New(s.Pool).HuntUses(ctx, insightsql.HuntUsesParams{TenantID: tenant, InsightID: id})
	if err != nil {
		return nil, err
	}
	huntUses, err := decode(huntRaw)
	if err != nil {
		return nil, err
	}
	result["hunt_items"] = huntUses["items"]
	return result, nil
}
