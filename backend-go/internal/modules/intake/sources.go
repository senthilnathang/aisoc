package intake

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
)

type Store struct{ Pool *pgxpool.Pool }
type Source struct {
	ID, Tenant, Name, Provider, Rule string
	Hash                             []byte
	Mapping                          map[string]any
	Expires, Created, Updated        time.Time
	Revoked                          *time.Time
}

const columns = `id,tenant_id,name,provider,rule_id,key_hash,mapping,expires_at,revoked_at,created_at,updated_at`

func scan(row pgx.Row) (Source, error) {
	var s Source
	err := row.Scan(&s.ID, &s.Tenant, &s.Name, &s.Provider, &s.Rule, &s.Hash, &s.Mapping, &s.Expires, &s.Revoked, &s.Created, &s.Updated)
	if errors.Is(err, pgx.ErrNoRows) {
		err = fault.New(404, "NOT_FOUND", "API source not found")
	}
	return s, err
}
func (s Source) View() map[string]any {
	status := "active"
	var revoked any
	if s.Revoked != nil {
		status = "revoked"
		revoked = investigations.Timestamp(*s.Revoked)
	} else if !s.Expires.After(time.Now()) {
		status = "expired"
	}
	return map[string]any{"id": s.ID, "tenant_id": s.Tenant, "name": s.Name, "provider": s.Provider, "rule_id": s.Rule, "mapping": s.Mapping, "expires_at": investigations.Timestamp(s.Expires), "revoked_at": revoked, "created_at": investigations.Timestamp(s.Created), "updated_at": investigations.Timestamp(s.Updated), "status": status, "intake_path": "/api/v1/intake/" + s.ID + "/alerts", "native_intake_path": "/api/v1/intake/" + s.ID + "/events", "source": "api-source:" + s.ID, "format": "normalized-alert-v1"}
}
func (s Store) Get(ctx context.Context, tenant, id string) (map[string]any, error) {
	v, err := scan(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM api_sources WHERE tenant_id=$1 AND id=$2`, tenant, id))
	if err != nil {
		return nil, err
	}
	return v.View(), nil
}
func (s Store) List(ctx context.Context, tenant string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+columns+` FROM api_sources WHERE tenant_id=$1 ORDER BY created_at DESC,ordinal DESC LIMIT 100`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, v.View())
	}
	return items, rows.Err()
}
func credential() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	key := "aisoc_src_" + base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(key))
	return key, hash[:], nil
}

// JavaScript trim includes BOM but excludes U+0085, unlike strings.TrimSpace.
func trim(value string) string {
	return strings.TrimFunc(value, func(r rune) bool {
		return r == '\uFEFF' || r == '\u0020' || r == '\u00A0' || r == '\u1680' || r >= '\u2000' && r <= '\u200A' || r == '\u2028' || r == '\u2029' || r == '\u202F' || r == '\u205F' || r == '\u3000' || r >= '\t' && r <= '\r'
	})
}
func (s Store) Create(ctx context.Context, tenant, name, provider, rule string, days int, actor string) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Serialize binding creation with rule deletion; both operations retain a
	// tenant-qualified foreign key as a second line of defense.
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM detection_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, rule).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Detection rule not found")
	}
	if err != nil {
		return nil, err
	}
	key, hash, err := credential()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	id = "SRC-" + jobs.ID()
	v, err := scan(tx.QueryRow(ctx, `INSERT INTO api_sources(id,tenant_id,name,provider,rule_id,key_hash,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING `+columns, id, tenant, trim(name), trim(provider), rule, hash, now.Add(time.Duration(days)*24*time.Hour), now))
	if err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "api_sources", id, "source_created", map[string]any{"actor_id": actor}); err != nil {
		return nil, err
	}
	return map[string]any{"source": v.View(), "api_key": key}, tx.Commit(ctx)
}
func (s Store) Mutate(ctx context.Context, tenant, id string, days int, actor string, revoke bool) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	v, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM api_sources WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id))
	if err != nil {
		return nil, err
	}
	key, action := "", "source_key_revoked"
	now := time.Now().UTC().Truncate(time.Millisecond)
	if revoke && v.Revoked != nil {
		return v.View(), tx.Commit(ctx)
	}
	if revoke {
		v, err = scan(tx.QueryRow(ctx, `UPDATE api_sources SET key_hash=NULL,revoked_at=$3,updated_at=$3 WHERE tenant_id=$1 AND id=$2 RETURNING `+columns, tenant, id, now))
	} else {
		var hash []byte
		key, hash, err = credential()
		if err != nil {
			return nil, err
		}
		action = "source_key_rotated"
		v, err = scan(tx.QueryRow(ctx, `UPDATE api_sources SET key_hash=$3,revoked_at=NULL,expires_at=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2 RETURNING `+columns, tenant, id, hash, now.Add(time.Duration(days)*24*time.Hour), now))
	}
	if err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "api_sources", id, action, map[string]any{"actor_id": actor}); err != nil {
		return nil, err
	}
	if revoke {
		return v.View(), tx.Commit(ctx)
	}
	return map[string]any{"source": v.View(), "api_key": key}, tx.Commit(ctx)
}

// Authenticate is a repository primitive for the future intake transaction.
// It does not authorize any HTTP intake endpoint yet. Intake must recheck the
// credential inside its write transaction to serialize with revoke/rotation.
func (s Store) Authenticate(ctx context.Context, id, key string) (string, error) {
	v, err := scan(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM api_sources WHERE id=$1`, id))
	if err != nil {
		var f *fault.Error
		if errors.As(err, &f) && f.Status == 404 {
			return "", nil
		}
		return "", err
	}
	hash := sha256.Sum256([]byte(key))
	if v.Revoked != nil || !v.Expires.After(time.Now()) || subtle.ConstantTimeCompare(hash[:], v.Hash) != 1 {
		return "", nil
	}
	return v.Tenant, nil
}
