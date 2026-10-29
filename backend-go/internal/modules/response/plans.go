package response

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
	"unicode/utf8"
)

type Step struct {
	Title            string `json:"title"`
	Instructions     string `json:"instructions"`
	ApprovalRequired bool   `json:"approval_required"`
}
type Input struct {
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Domain      string `json:"domain"`
	Trigger     string `json:"trigger"`
	Steps       []Step `json:"steps"`
}
type Plan struct {
	Input
	ID        string `json:"id"`
	Version   int    `json:"version"`
	State     string `json:"state"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}
type Event struct {
	Version   int    `json:"version"`
	Snapshot  Plan   `json:"snapshot"`
	Action    string `json:"action"`
	Actor     string `json:"actor"`
	CreatedAt string `json:"created_at"`
}
type Store struct{ Pool *pgxpool.Pool }

func (input Input) Validate() error {
	bad := func() error {
		return fault.New(400, "VALIDATION_ERROR", "Request does not match the response plan schema.")
	}
	if input.Kind != "workflow" && input.Kind != "runbook" {
		return bad()
	}
	for _, field := range []struct {
		value    string
		max      int
		required bool
	}{{input.Title, 200, true}, {input.Description, 4000, false}, {input.Domain, 100, true}, {input.Trigger, 500, true}} {
		if utf8.RuneCountInString(field.value) > field.max || (field.required && strings.TrimSpace(field.value) == "") {
			return bad()
		}
	}
	if len(input.Steps) < 1 || len(input.Steps) > 50 {
		return bad()
	}
	for _, step := range input.Steps {
		if strings.TrimSpace(step.Title) == "" || utf8.RuneCountInString(step.Title) > 300 || utf8.RuneCountInString(step.Instructions) > 4000 {
			return bad()
		}
	}
	return nil
}

func stamp() string  { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func missing() error { return fault.New(404, "NOT_FOUND", "Response plan not found") }
func conflict() error {
	return fault.New(409, "VERSION_CONFLICT", "This record changed. Reload it before saving your changes.")
}

type reader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func get(ctx context.Context, db reader, tenant, id string, lock bool) (Plan, error) {
	query := `SELECT document FROM response_plans WHERE tenant_id=$1 AND id=$2`
	if lock {
		query += " FOR UPDATE"
	}
	var raw []byte
	err := db.QueryRow(ctx, query, tenant, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Plan{}, missing()
	}
	if err != nil {
		return Plan{}, err
	}
	var p Plan
	err = json.Unmarshal(raw, &p)
	return p, err
}
func (s Store) Get(ctx context.Context, tenant, id string) (Plan, error) {
	return get(ctx, s.Pool, tenant, id, false)
}
func (s Store) List(ctx context.Context, tenant string) ([]Plan, error) {
	rows, err := s.Pool.Query(ctx, `SELECT document FROM response_plans WHERE tenant_id=$1 ORDER BY ordinal DESC`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Plan{}
	for rows.Next() {
		var raw []byte
		var p Plan
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	return items, rows.Err()
}
func save(ctx context.Context, tx pgx.Tx, tenant string, p Plan, action, actor string) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO response_plans(tenant_id,id,document) VALUES($1,$2,$3) ON CONFLICT(tenant_id,id) DO UPDATE SET document=excluded.document`, tenant, p.ID, raw)
	if err != nil {
		return err
	}
	at, err := time.Parse(time.RFC3339Nano, p.UpdatedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO response_plan_versions(tenant_id,plan_id,version,snapshot,action,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, tenant, p.ID, p.Version, raw, action, actor, at)
	return err
}
func (s Store) Create(ctx context.Context, tenant string, input Input, actor string) (Plan, error) {
	if err := input.Validate(); err != nil {
		return Plan{}, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback(ctx)
	// Local mode creates isolated tenants on first write. Token mode uses only its bound tenant.
	if _, err = tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant); err != nil {
		return Plan{}, err
	}
	now := stamp()
	p := Plan{Input: input, ID: jobs.ID(), Version: 1, State: "active", CreatedAt: now, UpdatedAt: now}
	if err = save(ctx, tx, tenant, p, "created", actor); err != nil {
		return Plan{}, err
	}
	return p, tx.Commit(ctx)
}
func (s Store) mutate(ctx context.Context, tenant, id string, version int, action, actor string, change func(*Plan) error) (Plan, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback(ctx)
	p, err := get(ctx, tx, tenant, id, true)
	if err != nil {
		return p, err
	}
	if p.Version != version {
		return p, conflict()
	}
	if err = change(&p); err != nil {
		return p, err
	}
	p.Version++
	p.UpdatedAt = stamp()
	if err = save(ctx, tx, tenant, p, action, actor); err != nil {
		return Plan{}, err
	}
	return p, tx.Commit(ctx)
}
func (s Store) Update(ctx context.Context, tenant, id string, version int, input Input, actor string) (Plan, error) {
	if err := input.Validate(); err != nil {
		return Plan{}, err
	}
	return s.mutate(ctx, tenant, id, version, "updated", actor, func(p *Plan) error {
		if p.State == "archived" {
			return fault.New(409, "ARCHIVED", "Restore this plan before editing it.")
		}
		if p.Kind != input.Kind {
			return fault.New(400, "INVALID_KIND", "A plan's kind cannot be changed.")
		}
		p.Input = input
		return nil
	})
}
func (s Store) State(ctx context.Context, tenant, id string, version int, state, actor string) (Plan, error) {
	if state != "active" && state != "archived" {
		return Plan{}, fault.New(400, "VALIDATION_ERROR", "Invalid plan state.")
	}
	action := "archived"
	if state == "active" {
		action = "restored"
	}
	return s.mutate(ctx, tenant, id, version, action, actor, func(p *Plan) error { p.State = state; return nil })
}
func (s Store) Duplicate(ctx context.Context, tenant, id, actor string) (Plan, error) {
	p, err := s.Get(ctx, tenant, id)
	if err != nil {
		return Plan{}, err
	}
	title := []rune(p.Title)
	if len(title) > 193 {
		title = title[:193]
	}
	p.Title = string(title) + " (copy)"
	return s.Create(ctx, tenant, p.Input, actor)
}
func (s Store) History(ctx context.Context, tenant, id string) ([]Event, error) {
	if _, err := s.Get(ctx, tenant, id); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT version,snapshot,action,actor,created_at FROM response_plan_versions WHERE tenant_id=$1 AND plan_id=$2 ORDER BY version DESC`, tenant, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Event{}
	for rows.Next() {
		var e Event
		var raw []byte
		var at time.Time
		if err = rows.Scan(&e.Version, &raw, &e.Action, &e.Actor, &at); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &e.Snapshot); err != nil {
			return nil, err
		}
		e.CreatedAt = at.UTC().Format("2006-01-02T15:04:05.000Z")
		items = append(items, e)
	}
	return items, rows.Err()
}
