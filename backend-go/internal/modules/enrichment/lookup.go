// Package enrichment provides opt-in, read-only local IOC context. No verdicts.
package enrichment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"regexp"
	"time"
)

var ErrInvalid = errors.New("invalid enrichment lookup")
var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

type Match struct {
	ID       string `json:"id"`
	ReportID string `json:"report_id"`
	Severity string `json:"severity"`
}
type Result struct {
	Tenant      string    `json:"tenant"`
	Kind        string    `json:"kind"`
	ValueHash   string    `json:"value_hash"`
	Generation  string    `json:"generation"`
	Provenance  string    `json:"provenance"`
	RetrievedAt time.Time `json:"retrieved_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	Matches     []Match   `json:"matches"`
	Truncated   bool      `json:"truncated"`
	CacheStatus string    `json:"-"`
}
type Store struct {
	Pool  *pgxpool.Pool
	Cache *Cache
}

// Lookup requires a tenant from authenticated Go context. Matching is exact,
// preserving existing IOC semantics; arbitrary provider URLs are never fetched.
func (s Store) Lookup(ctx context.Context, tenant, kind, value string) (Result, error) {
	var out Result
	if len(tenant) > 120 || !identifier.MatchString(tenant) || len(value) == 0 || len(value) > 512 {
		return out, ErrInvalid
	}
	switch kind {
	case "ip", "domain", "hash_sha256", "hash_md5", "url", "email", "cve":
	default:
		return out, ErrInvalid
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	// Revision read is deliberately authoritative even on cache hits.
	var generation string
	err = tx.QueryRow(ctx, `SELECT COALESCE(g.generation::text,'empty') FROM tenants t LEFT JOIN enrichment_generations g ON g.tenant_id=t.id WHERE t.id=$1`, tenant).Scan(&generation)
	if err != nil {
		return out, err
	}
	now := time.Now().UTC()
	key := field(kind, value, generation)
	state := "disabled"
	writable := false
	if s.Cache != nil {
		raw, cacheErr := s.Cache.get(ctx, tenant, key)
		if cacheErr != nil {
			state = "unavailable"
		} else {
			writable = true
			state = "miss"
			if cached, ok := decode(raw, tenant, kind, digest(value), generation, now); ok {
				cached.CacheStatus = "hit"
				return cached, tx.Commit(ctx)
			}
		}
	}
	rows, err := tx.Query(ctx, `SELECT id,report_id,severity FROM threat_indicators WHERE tenant_id=$1 AND indicator_type=$2 AND value=$3 AND status='active' ORDER BY ordinal LIMIT 33`, tenant, kind, value)
	if err != nil {
		return out, err
	}
	matches := []Match{}
	for rows.Next() {
		var m Match
		if err = rows.Scan(&m.ID, &m.ReportID, &m.Severity); err != nil {
			rows.Close()
			return out, err
		}
		matches = append(matches, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	truncated := len(matches) > 32
	if truncated {
		matches = matches[:32]
	}
	ttl := 30 * time.Second
	if len(matches) == 0 {
		ttl = 5 * time.Second
	}
	out = Result{Tenant: tenant, Kind: kind, ValueHash: digest(value), Generation: generation, Provenance: "tenant-local-active-indicators", RetrievedAt: now, ExpiresAt: now.Add(ttl), Matches: matches, Truncated: truncated, CacheStatus: state}
	if err = tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	if writable {
		raw, _ := json.Marshal(out)
		if _, ok := decode(raw, tenant, kind, digest(value), generation, time.Now().UTC()); ok {
			stored, cacheErr := s.Cache.put(ctx, tenant, key, raw)
			if cacheErr != nil {
				out.CacheStatus = "unavailable"
			} else if !stored {
				out.CacheStatus = "capacity"
			}
		} else {
			out.CacheStatus = "bypass"
		}
	}
	return out, nil
}
func decode(raw []byte, tenant, kind, valueHash, generation string, now time.Time) (Result, bool) {
	var r Result
	if len(raw) == 0 || len(raw) > 8192 {
		return r, false
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&r) != nil || d.Decode(new(any)) != io.EOF {
		return Result{}, false
	}
	canonical, err := json.Marshal(r)
	if err != nil || !bytes.Equal(canonical, raw) {
		return Result{}, false
	}
	ttl := 30 * time.Second
	if len(r.Matches) == 0 {
		ttl = 5 * time.Second
	}
	if r.Tenant != tenant || r.Kind != kind || r.ValueHash != valueHash || r.Generation != generation || r.Provenance != "tenant-local-active-indicators" || r.RetrievedAt.After(now) || !r.ExpiresAt.After(now) || r.ExpiresAt.Sub(r.RetrievedAt) != ttl || len(r.Matches) > 32 || r.Matches == nil || (r.Truncated && len(r.Matches) != 32) {
		return Result{}, false
	}
	seen := map[string]bool{}
	for _, m := range r.Matches {
		if !identifier.MatchString(m.ID) || !identifier.MatchString(m.ReportID) || seen[m.ID] {
			return Result{}, false
		}
		seen[m.ID] = true
		switch m.Severity {
		case "low", "medium", "high", "critical":
		default:
			return Result{}, false
		}
	}
	return r, true
}
