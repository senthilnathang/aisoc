package investigations

import (
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type Input struct {
	Title         string   `json:"title"`
	Summary       string   `json:"summary"`
	Source        string   `json:"source"`
	Category      string   `json:"category"`
	Severity      string   `json:"severity"`
	Status        string   `json:"status"`
	Determination string   `json:"determination"`
	RiskScore     int      `json:"risk_score"`
	Owner         string   `json:"owner"`
	PrimaryEntity string   `json:"primary_entity"`
	InsightRefs   []string `json:"insight_refs"`
}
type Record struct {
	Input
	ID          string `json:"id"`
	TenantID    string `json:"tenant_id"`
	ReplayCount int    `json:"replay_count"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// DetailRecord embeds the case directly instead of marshaling it into a generic
// map and parsing it again before the HTTP encoder serializes the response.
type DetailRecord struct {
	Record
	History           []Event          `json:"history"`
	Remediations      []map[string]any `json:"remediations"`
	SkillApplications []map[string]any `json:"skill_applications"`
	Alerts            []map[string]any `json:"alerts"`
	Jobs              []map[string]any `json:"jobs"`
	Steps             []map[string]any `json:"steps"`
	Feedback          []map[string]any `json:"feedback"`
	Artifacts         []map[string]any `json:"artifacts"`
}
type Event struct {
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id"`
	Resource   string         `json:"resource"`
	ResourceID string         `json:"resource_id"`
	Action     string         `json:"action"`
	Details    map[string]any `json:"details"`
	CreatedAt  string         `json:"created_at"`
	UpdatedAt  string         `json:"updated_at"`
}
type Store struct{ Pool *pgxpool.Pool }
type Queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}
type Scanner interface{ Scan(...any) error }
type ListOptions struct {
	Search, Status, Severity string
	Limit, Offset            int
}

const columns = `id,tenant_id,title,summary,source,category,severity,status,determination,risk_score,owner,primary_entity,replay_count,insight_refs,created_at,updated_at`
const auditInsert = `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`

func Missing() error               { return fault.New(404, "NOT_FOUND", "Investigation not found") }
func Timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
func scan(row Scanner) (Record, error) {
	var r Record
	var created, updated time.Time
	err := row.Scan(&r.ID, &r.TenantID, &r.Title, &r.Summary, &r.Source, &r.Category, &r.Severity, &r.Status, &r.Determination, &r.RiskScore, &r.Owner, &r.PrimaryEntity, &r.ReplayCount, &r.InsightRefs, &created, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, Missing()
	}
	r.CreatedAt = Timestamp(created)
	r.UpdatedAt = Timestamp(updated)
	return r, err
}

// Lock is shared with response transactions. It serializes case deletion and attachment mutations.
func Lock(ctx context.Context, db Queryer, tenant, id string) error {
	var found string
	err := db.QueryRow(ctx, `SELECT id FROM investigations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return Missing()
	}
	return err
}
func Exists(ctx context.Context, db Queryer, tenant, id string) error {
	var found string
	err := db.QueryRow(ctx, `SELECT id FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return Missing()
	}
	return err
}

// Audit participates in the caller's transaction, including response-assignment updates.
func Audit(ctx context.Context, tx pgx.Tx, tenant, id, action string, details map[string]any) error {
	return ResourceAudit(ctx, tx, tenant, "investigations", id, action, details)
}
func ResourceAudit(ctx context.Context, tx pgx.Tx, tenant, resource, id, action string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	_, err = tx.Exec(ctx, auditInsert, tenant, jobs.ID(), resource, id, action, raw, now)
	return err
}
func (s Store) Create(ctx context.Context, tenant string, in Input) (Record, error) {
	if in.Title == "" || in.Source == "" || !contains([]string{"low", "medium", "high", "critical"}, in.Severity) || !contains([]string{"open", "investigating", "contained", "resolved", "closed"}, in.Status) || !contains([]string{"unknown", "benign", "suspicious", "malicious", "mitigated"}, in.Determination) || in.RiskScore < 0 || in.RiskScore > 100 {
		return Record{}, fault.New(400, "VALIDATION_ERROR", "Invalid investigation fields.")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx)
	id := "INV-" + jobs.ID()[:8]
	now := time.Now().UTC().Truncate(time.Millisecond)
	if in.InsightRefs == nil {
		in.InsightRefs = []string{}
	}
	refs, err := json.Marshal(in.InsightRefs)
	if err != nil {
		return Record{}, err
	}
	// Both commands run in order in this transaction, using one network exchange.
	batch := &pgx.Batch{}
	batch.Queue(`INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant)
	batch.Queue(`INSERT INTO investigations(tenant_id,id,title,summary,source,category,severity,status,determination,risk_score,owner,primary_entity,insight_refs,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING `+columns, tenant, id, in.Title, in.Summary, in.Source, in.Category, in.Severity, in.Status, in.Determination, in.RiskScore, in.Owner, in.PrimaryEntity, refs, now)
	results := tx.SendBatch(ctx, batch)
	if _, err = results.Exec(); err != nil {
		results.Close()
		return Record{}, err
	}
	r, err := scan(results.QueryRow())
	closeErr := results.Close()
	if err != nil {
		return Record{}, err
	}
	if closeErr != nil {
		return Record{}, closeErr
	}
	if _, err = skills.Apply(ctx, tx, tenant, "investigation", id, skills.Context{Module: "investigations", Source: in.Source, Title: in.Title, Category: in.Category, SourceEntities: []string{in.PrimaryEntity}, InsightRefs: in.InsightRefs}); err != nil {
		return Record{}, err
	}
	if err = Audit(ctx, tx, tenant, id, "created", nil); err != nil {
		return Record{}, err
	}
	return r, tx.Commit(ctx)
}
func (s Store) Get(ctx context.Context, tenant, id string) (Record, error) {
	return scan(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, id))
}
func (s Store) List(ctx context.Context, tenant string, o ListOptions) ([]Record, error) {
	if o.Limit == 0 {
		o.Limit = 100
	}
	if o.Limit < 1 || o.Limit > 500 || o.Offset < 0 {
		return nil, fault.New(400, "VALIDATION_ERROR", "Invalid pagination.")
	}
	// SQLite LIKE permits SQL wildcards in this legacy resource, unlike the detection registry.
	rows, err := s.Pool.Query(ctx, `SELECT `+columns+` FROM investigations WHERE tenant_id=$1 AND ($2='' OR status=$2) AND ($3='' OR severity=$3) AND ($4='' OR title ILIKE $5 ESCAPE '' OR source ILIKE $5 ESCAPE '' OR primary_entity ILIKE $5 ESCAPE '') ORDER BY updated_at DESC,id LIMIT $6 OFFSET $7`, tenant, o.Status, o.Severity, o.Search, "%"+o.Search+"%", o.Limit, o.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Record{}
	for rows.Next() {
		r, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, r)
	}
	return items, rows.Err()
}
func history(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, tenant, id string) ([]Event, error) {
	return ResourceHistory(ctx, db, tenant, "investigations", id)
}
func ResourceHistory(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, tenant, resource, id string) ([]Event, error) {
	rows, err := db.Query(ctx, `SELECT id,tenant_id,resource,resource_id,action,details,created_at,updated_at FROM audit_events WHERE tenant_id=$1 AND resource=$2 AND resource_id=$3 ORDER BY created_at DESC,ordinal DESC LIMIT 100`, tenant, resource, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Event{}
	for rows.Next() {
		var e Event
		var created, updated time.Time
		if err = rows.Scan(&e.ID, &e.TenantID, &e.Resource, &e.ResourceID, &e.Action, &e.Details, &created, &updated); err != nil {
			return nil, err
		}
		e.CreatedAt = Timestamp(created)
		e.UpdatedAt = Timestamp(updated)
		items = append(items, e)
	}
	return items, rows.Err()
}
func (s Store) History(ctx context.Context, tenant, id string) ([]Event, error) {
	if err := Exists(ctx, s.Pool, tenant, id); err != nil {
		return nil, err
	}
	return history(ctx, s.Pool, tenant, id)
}
func (s Store) Delete(ctx context.Context, tenant, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = Lock(ctx, tx, tenant, id); err != nil {
		return err
	}
	var referenced bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM alerts WHERE tenant_id=$1 AND investigation_id=$2)`, tenant, id).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		return fault.New(409, "ALERT_REFERENCE_EXISTS", "This record is retained by ingested alerts. Close the case or disable the rule instead.")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, id); err != nil {
		return err
	}
	if err = Audit(ctx, tx, tenant, id, "deleted", nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// Detail reads all related records from the same repeatable-read snapshot.
func (s Store) Detail(ctx context.Context, tenant, id string) (*DetailRecord, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	r, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, id))
	if err != nil {
		return nil, err
	}
	events, err := history(ctx, tx, tenant, id)
	if err != nil {
		return nil, err
	}
	data := &DetailRecord{Record: r, History: events}
	remediations, err := RemediationRecords(ctx, tx, tenant, id, "", "", 100, 0)
	if err != nil {
		return nil, err
	}
	applications, err := skills.Applications(ctx, tx, tenant, "investigation", id)
	if err != nil {
		return nil, err
	}
	data.SkillApplications = applications
	data.Remediations = remediations
	alerts, jobs, err := AlertContext(ctx, tx, tenant, id)
	if err != nil {
		return nil, err
	}
	data.Alerts = alerts
	data.Jobs = jobs
	stepRecords, err := steps(ctx, tx, tenant, id)
	if err != nil {
		return nil, err
	}
	data.Steps = stepRecords
	if data.Feedback, err = records(ctx, tx, tenant, id, "feedback"); err != nil {
		return nil, err
	}
	if data.Artifacts, err = records(ctx, tx, tenant, id, "artifacts"); err != nil {
		return nil, err
	}
	return data, tx.Commit(ctx)
}
