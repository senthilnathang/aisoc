package localintegrations

import (
	"aisoc/backend/internal/modules/localintegrations/localsql"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
	"strings"
	"time"
)

var profileID = regexp.MustCompile(`^build-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func ValidID(id string) bool { return profileID.MatchString(id) }

type Store struct{ Pool *pgxpool.Pool }
type Profile struct {
	ID        string    `json:"id"`
	ScopeID   string    `json:"scope_id"`
	Name      string    `json:"name"`
	Version   int32     `json:"version"`
	State     string    `json:"state"`
	Document  Document  `json:"document"`
	UpdatedAt time.Time `json:"updated_at"`
	Actor     string    `json:"actor"`
}

func View(row localsql.LocalIntegrationProfile) (Profile, error) {
	p := Profile{ID: row.ID, ScopeID: row.ScopeID, Name: row.Name, Version: row.Version, State: row.State, UpdatedAt: row.UpdatedAt.Time, Actor: row.Actor}
	err := json.Unmarshal(row.Document, &p.Document)
	return p, err
}
func Binding(tenant, id string) telemetry.Binding {
	return telemetry.Binding{TenantID: tenant, ConnectorID: id, Source: "qradar-siem"}
}
func (s Store) Get(ctx context.Context, tenant, id string) (Profile, error) {
	r, e := localsql.New(s.Pool).GetProfile(ctx, localsql.GetProfileParams{TenantID: tenant, ID: id})
	if errors.Is(e, pgx.ErrNoRows) {
		return Profile{}, fault.New(404, "LOCAL_INTEGRATION_NOT_FOUND", "Local integration profile not found.")
	}
	if e != nil {
		return Profile{}, e
	}
	return View(r)
}
func (s Store) List(ctx context.Context, tenant string) ([]Profile, error) {
	rows, e := localsql.New(s.Pool).ListProfiles(ctx, tenant)
	if e != nil {
		return nil, e
	}
	out := []Profile{}
	for _, r := range rows {
		p, e := View(r)
		if e != nil {
			return nil, e
		}
		out = append(out, p)
	}
	return out, nil
}
func (s Store) Save(ctx context.Context, tenant, actor, id, scope, name string, expected int32, d Document) (Profile, error) {
	name = strings.TrimSpace(name)
	if !profileID.MatchString(id) || len(name) < 1 || len(name) > 120 || strings.ContainsRune(name, 0) || expected < 0 {
		return Profile{}, Invalid()
	}
	preview, err := Preview(d, Binding(tenant, id), time.Now())
	if err != nil {
		return Profile{}, err
	}
	d.Events = preview.Events
	raw, _ := json.Marshal(d)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Profile{}, err
	}
	defer tx.Rollback(ctx)
	q := localsql.New(tx)
	if err = q.EnsureTenant(ctx, tenant); err != nil {
		return Profile{}, err
	}
	if _, err = q.LockTenant(ctx, tenant); err != nil {
		return Profile{}, err
	}
	row, err := q.LockProfile(ctx, localsql.LockProfileParams{TenantID: tenant, ID: id})
	action := "local_integration_created"
	if errors.Is(err, pgx.ErrNoRows) {
		if expected != 0 {
			return Profile{}, Conflict()
		}
		n, err := q.CountProfiles(ctx, tenant)
		if err != nil {
			return Profile{}, err
		}
		if n >= 20 {
			return Profile{}, Conflict()
		}
		row, err = q.InsertProfile(ctx, localsql.InsertProfileParams{TenantID: tenant, ID: id, ScopeID: scope, Name: name, Document: raw, Actor: actor})
		if err != nil {
			return Profile{}, err
		}
	} else if err != nil {
		return Profile{}, err
	} else {
		if row.ScopeID != scope {
			return Profile{}, Conflict()
		}
		var old Document
		if json.Unmarshal(row.Document, &old) != nil {
			return Profile{}, Invalid()
		}
		canonical, _ := json.Marshal(old)
		if row.State == "draft" && row.Name == name && string(canonical) == string(raw) && row.Actor == actor && (expected == row.Version || expected == row.Version-1) {
			p, e := View(row)
			if e != nil {
				return Profile{}, e
			}
			return p, tx.Commit(ctx)
		}
		if row.State != "draft" || row.Version != expected {
			return Profile{}, Conflict()
		}
		row, err = q.UpdateProfile(ctx, localsql.UpdateProfileParams{TenantID: tenant, ID: id, Name: name, Document: raw, Actor: actor})
		if err != nil {
			return Profile{}, err
		}
		action = "local_integration_updated"
	}
	details, _ := json.Marshal(map[string]any{"actor": actor, "version": row.Version, "scope": scope})
	if err = q.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: id, Action: action, Details: details}); err != nil {
		return Profile{}, err
	}
	p, err := View(row)
	if err != nil {
		return Profile{}, err
	}
	return p, tx.Commit(ctx)
}
func (s Store) Seal(ctx context.Context, tenant, actor, id, scope string, expected int32) (Profile, error) {
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
	if row.ScopeID != scope || row.Version != expected {
		return Profile{}, Conflict()
	}
	if row.State == "draft" {
		row, err = q.SealProfile(ctx, localsql.SealProfileParams{TenantID: tenant, ID: id})
		if err != nil {
			return Profile{}, err
		}
		details, _ := json.Marshal(map[string]any{"actor": actor, "version": row.Version})
		if err = q.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: id, Action: "local_integration_sealed", Details: details}); err != nil {
			return Profile{}, err
		}
	}
	p, err := View(row)
	if err != nil {
		return Profile{}, err
	}
	return p, tx.Commit(ctx)
}
