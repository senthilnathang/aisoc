package localintegrations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"aisoc/backend/internal/modules/localintegrations/localsql"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
)

// Archive preserves evidence. A sealed snapshot must finish its mock write-back
// first, so archival cannot race with new intake or strand a pending investigation.
func (s Store) Archive(ctx context.Context, tenant, actor, id string, expected int32) (Profile, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Profile{}, err
	}
	defer tx.Rollback(ctx)
	q := localsql.New(tx)
	row, err := q.LockProfile(ctx, localsql.LockProfileParams{TenantID: tenant, ID: id})
	if err != nil {
		return Profile{}, err
	}
	if row.State == "archived" && row.Actor == actor && (expected == row.Version || expected == row.Version-1) {
		p, e := View(row)
		if e != nil {
			return p, e
		}
		return p, tx.Commit(ctx)
	}
	if row.Version != expected || row.State == "archived" {
		return Profile{}, Conflict()
	}
	if row.State == "sealed" {
		allowed, e := q.CanArchiveProfile(ctx, localsql.CanArchiveProfileParams{TenantID: tenant, ConnectorID: id})
		if e != nil {
			return Profile{}, e
		}
		ready, e := q.ProfileSnapshotReady(ctx, localsql.ProfileSnapshotReadyParams{TenantID: tenant, ID: id})
		if e != nil {
			return Profile{}, e
		}
		if !allowed.Valid || !allowed.Bool || !ready.Valid || !ready.Bool {
			return Profile{}, fault.New(409, "LOCAL_INTEGRATION_ACTIVE", "Finish the pending import, investigation review and mock write-back before archiving.")
		}
	}
	row, err = q.ArchiveProfile(ctx, localsql.ArchiveProfileParams{TenantID: tenant, ID: id, Actor: actor})
	if err != nil {
		return Profile{}, err
	}
	details, _ := json.Marshal(map[string]any{"actor": actor, "version": row.Version})
	if err = q.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: id, Action: "local_integration_archived", Details: details}); err != nil {
		return Profile{}, err
	}
	p, err := View(row)
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

// Clone copies a reviewed snapshot into a new connector identity. No event,
// investigation, approval or response receipt is copied or executed.
func (s Store) Clone(ctx context.Context, tenant, actor, source string, expected int32, id, name string) (Profile, error) {
	name = strings.TrimSpace(name)
	if !ValidID(id) || id == source || expected < 1 || len(name) < 1 || len(name) > 120 || strings.ContainsRune(name, 0) {
		return Profile{}, Invalid()
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Profile{}, err
	}
	defer tx.Rollback(ctx)
	q := localsql.New(tx)
	if _, err = q.LockTenant(ctx, tenant); err != nil {
		return Profile{}, err
	}
	parent, err := q.LockProfile(ctx, localsql.LockProfileParams{TenantID: tenant, ID: source})
	if err != nil {
		return Profile{}, err
	}
	existing, e := q.GetProfile(ctx, localsql.GetProfileParams{TenantID: tenant, ID: id})
	if e == nil {
		if existing.ClonedFrom != source || existing.ClonedVersion != expected || existing.CloneName != name {
			return Profile{}, Conflict()
		}
		p, e := View(existing)
		if e != nil {
			return p, e
		}
		return p, tx.Commit(ctx)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Profile{}, e
	}
	if parent.Version != expected {
		return Profile{}, Conflict()
	}
	count, err := q.CountProfiles(ctx, tenant)
	if err != nil {
		return Profile{}, err
	}
	if count >= 20 {
		return Profile{}, Conflict()
	}
	p, err := View(parent)
	if err != nil {
		return p, err
	}
	preview, err := Preview(p.Document, Binding(tenant, id), time.Now())
	if err != nil {
		return Profile{}, err
	}
	p.Document.Events = preview.Events
	raw, _ := json.Marshal(p.Document)
	row, err := q.InsertClone(ctx, localsql.InsertCloneParams{TenantID: tenant, ID: id, ScopeID: parent.ScopeID, Name: name, Document: raw, Actor: actor, ClonedFrom: source, ClonedVersion: expected})
	if err != nil {
		return Profile{}, err
	}
	details, _ := json.Marshal(map[string]any{"actor": actor, "source_id": source, "source_version": expected, "version": row.Version})
	if err = q.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: id, Action: "local_integration_cloned", Details: details}); err != nil {
		return Profile{}, err
	}
	p, err = View(row)
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

type Revision struct {
	Version    int32     `json:"version"`
	Name       string    `json:"name"`
	State      string    `json:"state"`
	Actor      string    `json:"actor"`
	RecordedAt time.Time `json:"recorded_at"`
}

func (s Store) History(ctx context.Context, tenant, id string) ([]Revision, error) {
	rows, err := localsql.New(s.Pool).ProfileHistory(ctx, localsql.ProfileHistoryParams{TenantID: tenant, ProfileID: id})
	if err != nil {
		return nil, err
	}
	out := []Revision{}
	for _, r := range rows {
		out = append(out, Revision{r.Version, r.Name, r.State, r.Actor, r.RecordedAt.Time})
	}
	return out, nil
}
func (s Store) IntakeStatus(ctx context.Context, tenant, id string) (map[string]any, error) {
	r, err := localsql.New(s.Pool).ProfileIntakeStatus(ctx, localsql.ProfileIntakeStatusParams{TenantID: tenant, ConnectorID: id})
	return map[string]any{"accepted_events": r.AcceptedEvents, "processed_events": r.ProcessedEvents}, err
}
