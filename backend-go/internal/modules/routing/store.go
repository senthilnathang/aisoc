package routing

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/routing/routingsql"
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
	"time"
)

type Store struct{ Pool *pgxpool.Pool }
type State struct {
	Config    Config `json:"config"`
	Version   int    `json:"version"`
	UpdatedBy string `json:"updated_by"`
	UpdatedAt any    `json:"updated_at"`
}

func Empty() Config { return Config{Policies: []Policy{}, Lists: []EntityList{}} }
func Load(ctx context.Context, db routingsql.DBTX, tenant string) (State, error) {
	s := State{Config: Empty()}
	r, e := routingsql.New(db).Config(ctx, tenant)
	if errors.Is(e, pgx.ErrNoRows) {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(r.Document, &s.Config)
	s.Version = int(r.Version)
	s.UpdatedBy = r.UpdatedBy
	s.UpdatedAt = r.UpdatedAt.Time
	return s, e
}
func (s Store) Get(ctx context.Context, tenant string) (State, error) {
	return Load(ctx, s.Pool, tenant)
}
func (s Store) Audit(ctx context.Context, tenant string) (json.RawMessage, error) {
	return routingsql.New(s.Pool).Audit(ctx, tenant)
}
func conflict(message string) error { return fault.New(409, "ROUTING_CONFLICT", message) }
func digest(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func sample(ctx context.Context, q *routingsql.Queries, tenant string, end time.Time) ([]Event, error) {
	rows, e := q.Sample(ctx, routingsql.SampleParams{TenantID: tenant, WindowEnd: pgtype.Timestamptz{Time: end, Valid: true}})
	if e != nil {
		return nil, e
	}
	out := []Event{}
	for _, r := range rows {
		out = append(out, Event{r.ID, r.Source, r.ExternalID, r.RuleID, r.Severity, r.Entity, r.Fallback, r.Enabled})
	}
	return out, nil
}

type PreviewInput struct {
	Config          Config `json:"config"`
	ExpectedVersion int    `json:"expected_version"`
}
type SaveInput struct {
	Config          Config `json:"config"`
	ExpectedVersion int    `json:"expected_version"`
	PreviewID       string `json:"preview_id"`
}

func active(c Config) Config {
	a := Empty()
	for _, p := range c.Policies {
		if p.Status == "enabled" {
			a.Policies = append(a.Policies, p)
		}
	}
	if len(a.Policies) > 0 {
		a.Lists = c.Lists
	}
	return a
}
func begin(ctx context.Context, pool *pgxpool.Pool, tenant string) (pgx.Tx, error) {
	tx, e := pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	q := routingsql.New(tx)
	if e = q.EnsureTenant(ctx, tenant); e == nil {
		_, e = q.LockTenant(ctx, tenant)
	}
	if e != nil {
		tx.Rollback(ctx)
		return nil, e
	}
	return tx, nil
}
func (s Store) Simulate(ctx context.Context, tenant, actor string, in PreviewInput) (map[string]any, error) {
	if e := Validate(in.Config); e != nil {
		return nil, fault.New(400, "VALIDATION_ERROR", e.Error())
	}
	tx, e := begin(ctx, s.Pool, tenant)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	state, e := Load(ctx, tx, tenant)
	if e != nil {
		return nil, e
	}
	if state.Version != in.ExpectedVersion {
		return nil, conflict("Routing changed; reload before preview")
	}
	q := routingsql.New(tx)
	end := time.Now().UTC()
	events, e := sample(ctx, q, tenant, end)
	if e != nil {
		return nil, e
	}
	counts := map[string]int{}
	rules := map[string]map[string]bool{}
	rows := []map[string]any{}
	for _, event := range events {
		d := Evaluate(in.Config, state.Version+1, event)
		if d.PolicyID != "" {
			counts[d.PolicyID]++
			if rules[d.PolicyID] == nil {
				rules[d.PolicyID] = map[string]bool{}
			}
			rules[d.PolicyID][event.RuleID] = true
		}
		rows = append(rows, map[string]any{"event": event, "decision": d})
	}
	impacts := map[string]any{}
	for _, p := range in.Config.Policies {
		impacts[p.ID] = map[string]int{"matched_alerts": counts[p.ID], "impacted_rules": len(rules[p.ID])}
	}
	id := "RP-" + jobs.ID()
	raw, _ := json.Marshal(in.Config)
	if e = q.PrunePreviews(ctx, tenant); e != nil {
		return nil, e
	}
	if e = q.SavePreview(ctx, routingsql.SavePreviewParams{TenantID: tenant, ID: id, BaseVersion: int32(state.Version), Document: raw, SampleHash: digest(events), WindowEnd: pgtype.Timestamptz{Time: end, Valid: true}}); e != nil {
		return nil, e
	}
	if e = investigations.ResourceAudit(ctx, tx, tenant, "detection_routing", "config", "routing_preview", map[string]any{"actor": actor, "preview_id": id, "base_version": state.Version, "sample_size": len(events)}); e != nil {
		return nil, e
	}
	return map[string]any{"preview_id": id, "sample_size": len(events), "sample_limit": 500, "window_end": end, "impacts": impacts, "events": rows, "scope": "Latest 500 stored alerts at cutoff; route eligibility, not sampling selection or future outcome guarantee"}, tx.Commit(ctx)
}
func (s Store) Save(ctx context.Context, tenant, actor string, in SaveInput) (State, error) {
	var zero State
	if actor == "" || in.ExpectedVersion < 0 || in.ExpectedVersion >= 2147483647 {
		return zero, fault.New(400, "VALIDATION_ERROR", "Actor and valid version required")
	}
	if e := Validate(in.Config); e != nil {
		return zero, fault.New(400, "VALIDATION_ERROR", e.Error())
	}
	tx, e := begin(ctx, s.Pool, tenant)
	if e != nil {
		return zero, e
	}
	defer tx.Rollback(ctx)
	old, e := Load(ctx, tx, tenant)
	if e != nil {
		return zero, e
	}
	if old.Version != in.ExpectedVersion {
		return zero, conflict("Routing changed; reload before saving")
	}
	q := routingsql.New(tx)
	if len(active(in.Config).Policies) > 0 && digest(active(in.Config)) != digest(active(old.Config)) {
		rec, err := q.Preview(ctx, routingsql.PreviewParams{TenantID: tenant, ID: in.PreviewID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return zero, conflict("Preview this configuration before enabling or changing active routing")
			}
			return zero, err
		}
		var saved Config
		if json.Unmarshal(rec.Document, &saved) != nil || digest(saved) != digest(in.Config) || int(rec.BaseVersion) != old.Version || time.Since(rec.CreatedAt.Time) > 15*time.Minute {
			return zero, conflict("Preview is stale or describes different configuration; preview again")
		}
		events, err := sample(ctx, q, tenant, rec.WindowEnd.Time)
		if err != nil {
			return zero, err
		}
		if len(events) == 0 || digest(events) != rec.SampleHash {
			return zero, conflict("Preview requires unchanged stored evidence; import sample alerts and preview again")
		}
	}
	raw, _ := json.Marshal(in.Config)
	v := old.Version + 1
	if e = q.SaveConfig(ctx, routingsql.SaveConfigParams{TenantID: tenant, Version: int32(v), Document: raw, UpdatedBy: actor}); e != nil {
		return zero, e
	}
	if e = investigations.ResourceAudit(ctx, tx, tenant, "detection_routing", "config", "routing_saved", map[string]any{"actor": actor, "version": v, "previous_version": old.Version, "before": old.Config, "after": in.Config, "preview_id": in.PreviewID}); e != nil {
		return zero, e
	}
	out, e := Load(ctx, tx, tenant)
	if e != nil {
		return zero, e
	}
	return out, tx.Commit(ctx)
}
