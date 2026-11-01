package hunts

import (
	"aisoc/backend/internal/modules/hunts/huntsql"
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const SearchScope = "Case-insensitive literal phrase search in the latest 500 stored cases and 500 artifacts for this tenant. At most 100 matching records returned. No live source queries, LLM reasoning or response execution. No match is inconclusive."

var requestID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

func validateSearch(id, query string) error {
	if !requestID.MatchString(id) || len(strings.TrimSpace(query)) < 2 || utf8.RuneCountInString(query) > 200 || strings.ContainsRune(query, 0) {
		return fault.New(400, "VALIDATION_ERROR", "Use a request ID and a literal search phrase of 2–200 characters.")
	}
	return nil
}

type Finding struct {
	RecordID string `json:"record_id"`
	CaseID   string `json:"case_id"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Excerpt  string `json:"excerpt"`
	Source   string `json:"source"`
	Entity   string `json:"entity"`
}
type Run struct {
	Memory          []map[string]any `json:"memory"`
	MemoryTruncated bool             `json:"memory_truncated"`
	MemoryPolicy    string           `json:"memory_policy"`
	ID              string           `json:"id"`
	Query           string           `json:"query"`
	Expected        string           `json:"expected_updated_at"`
	Actor           string           `json:"actor"`
	CreatedAt       string           `json:"created_at"`
	Verdict         string           `json:"verdict"`
	Scope           string           `json:"scope"`
	Truncated       bool             `json:"truncated"`
	Findings        []Finding        `json:"findings"`
}
type Note struct {
	ID        string `json:"id"`
	Actor     string `json:"actor"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}
type Workspace struct {
	Promotions []json.RawMessage `json:"promotions"`
	Intel      []map[string]any  `json:"intel"`
	Hunt       map[string]any    `json:"hunt"`
	Runs       []Run             `json:"runs"`
	Notes      []Note            `json:"notes"`
	Scope      string            `json:"scope"`
}

func locked(ctx context.Context, q *huntsql.Queries, tenant, id string) (map[string]any, error) {
	raw, err := q.LockHunt(ctx, huntsql.LockHuntParams{TenantID: tenant, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing()
	}
	if err != nil {
		return nil, err
	}
	var h map[string]any
	err = json.Unmarshal(raw, &h)
	return h, err
}
func (s Store) Search(ctx context.Context, tenant, id, actor, key, expected string) (Run, error) {
	if !requestID.MatchString(key) || expected == "" {
		return Run{}, fault.New(400, "VALIDATION_ERROR", "A request ID and expected_updated_at are required.")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Run{}, err
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	h, err := locked(ctx, q, tenant, id)
	if err != nil {
		return Run{}, err
	}
	prior, err := q.HuntRun(ctx, huntsql.HuntRunParams{TenantID: tenant, HuntID: id, ID: key})
	if err == nil {
		var r Run
		if err = json.Unmarshal(prior, &r); err != nil {
			return Run{}, err
		}
		if r.Expected != expected || r.Actor != actor {
			return Run{}, fault.New(409, "VERSION_CONFLICT", "Request ID already used for another request.")
		}
		return r, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Run{}, err
	}
	if h["updated_at"] != expected {
		return Run{}, fault.New(409, "VERSION_CONFLICT", "This hunt changed. Reload before running it.")
	}
	query, _ := h["query"].(string)
	query = strings.TrimSpace(query)
	if err = validateSearch(key, query); err != nil {
		return Run{}, err
	}
	n, err := q.HuntRunCount(ctx, huntsql.HuntRunCountParams{TenantID: tenant, HuntID: id})
	if err != nil {
		return Run{}, err
	}
	if n >= 100 {
		return Run{}, fault.New(409, "LIMIT_REACHED", "This local hunt has reached its 100-run retention limit.")
	}
	rows, err := q.HuntEvidence(ctx, huntsql.HuntEvidenceParams{TenantID: tenant, Column2: query})
	if err != nil {
		return Run{}, err
	}
	r := Run{ID: key, Query: query, Expected: expected, Actor: actor, CreatedAt: investigations.Timestamp(time.Now().UTC()), Verdict: "inconclusive", Scope: SearchScope, Findings: []Finding{}, Truncated: len(rows) > 100}
	if len(rows) > 100 {
		rows = rows[:100]
	}
	for _, row := range rows {
		r.Findings = append(r.Findings, Finding{row.RecordID, row.CaseID, row.Kind, row.Label, row.Excerpt, row.Source, row.Entity})
	}
	entities := []string{query}
	for _, finding := range r.Findings {
		entities = append(entities, finding.Entity)
	}
	r.Memory, r.MemoryTruncated, err = insights.HuntSnapshots(ctx, tx, tenant, id, key, actor, r.CreatedAt, entities)
	if err != nil {
		return Run{}, err
	}
	r.MemoryPolicy = "exact-entity-current-approved-v1"
	if len(r.Findings) > 0 {
		r.Verdict = "review_required"
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return Run{}, err
	}
	if err = q.InsertHuntRun(ctx, huntsql.InsertHuntRunParams{TenantID: tenant, HuntID: id, ID: key, Document: raw}); err != nil {
		return Run{}, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "hunts", id, "local_search", map[string]any{"request_id": key, "actor": actor, "matches": len(r.Findings), "truncated": r.Truncated}); err != nil {
		return Run{}, err
	}
	return r, tx.Commit(ctx)
}
func (s Store) Workspace(ctx context.Context, tenant, id string) (Workspace, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Workspace{}, err
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	raw, err := q.HuntDocument(ctx, huntsql.HuntDocumentParams{TenantID: tenant, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, missing()
	}
	if err != nil {
		return Workspace{}, err
	}
	var h map[string]any
	if err = json.Unmarshal(raw, &h); err != nil {
		return Workspace{}, err
	}
	w := Workspace{Hunt: h, Runs: []Run{}, Notes: []Note{}, Scope: SearchScope}
	rows, err := q.HuntRuns(ctx, huntsql.HuntRunsParams{TenantID: tenant, HuntID: id})
	if err != nil {
		return w, err
	}
	for _, raw := range rows {
		var r Run
		if err = json.Unmarshal(raw, &r); err != nil {
			return w, err
		}
		w.Runs = append(w.Runs, r)
	}
	notes, err := q.HuntNotes(ctx, huntsql.HuntNotesParams{TenantID: tenant, HuntID: id})
	if err != nil {
		return w, err
	}
	for _, n := range notes {
		w.Notes = append(w.Notes, Note{n.ID, n.Actor, n.Body, investigations.Timestamp(n.CreatedAt.Time)})
	}
	promotions, e := q.HuntPromotions(ctx, huntsql.HuntPromotionsParams{TenantID: tenant, HuntID: id})
	if e != nil {
		return w, e
	}
	w.Promotions = []json.RawMessage{}
	for _, raw := range promotions {
		w.Promotions = append(w.Promotions, raw)
	}
	links, e := q.HuntSourceIntel(ctx, huntsql.HuntSourceIntelParams{TenantID: tenant, HuntID: id})
	if e != nil {
		return w, e
	}
	w.Intel = []map[string]any{}
	for _, link := range links {
		w.Intel = append(w.Intel, map[string]any{"report_id": link.ReportID, "indicator_id": link.IndicatorID, "indicator_value": link.IndicatorValue})
	}
	return w, tx.Commit(ctx)
}
func (s Store) AddNote(ctx context.Context, tenant, id, actor, key, body string) error {
	body = strings.TrimSpace(body)
	if !requestID.MatchString(key) || body == "" || utf8.RuneCountInString(body) > 4000 || strings.ContainsRune(body, 0) {
		return fault.New(400, "VALIDATION_ERROR", "Use a request ID and a note of 1–4000 characters.")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	if _, err = locked(ctx, q, tenant, id); err != nil {
		return err
	}
	old, err := q.HuntNote(ctx, huntsql.HuntNoteParams{TenantID: tenant, HuntID: id, ID: key})
	if err == nil {
		if old.Actor != actor || old.Body != body {
			return fault.New(409, "VERSION_CONFLICT", "Note ID already used.")
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	n, err := q.HuntNoteCount(ctx, huntsql.HuntNoteCountParams{TenantID: tenant, HuntID: id})
	if err != nil {
		return err
	}
	if n >= 100 {
		return fault.New(409, "LIMIT_REACHED", "This local hunt has reached its 100-note limit.")
	}
	if err = q.InsertHuntNote(ctx, huntsql.InsertHuntNoteParams{TenantID: tenant, HuntID: id, ID: key, Actor: actor, Body: body}); err != nil {
		return err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "hunts", id, "note_added", map[string]any{"actor": actor, "note_id": key}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
