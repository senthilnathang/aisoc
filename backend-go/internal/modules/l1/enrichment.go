package l1

import (
	"aisoc/backend/internal/modules/enrichment"
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"time"
)

// EnrichLogin is an explicit Go evidence tool for an admitted finding. Local IOC
// results are context, not a verdict, and are not automatically sent to Python.
func EnrichLogin(ctx context.Context, pool *pgxpool.Pool, cache *enrichment.Cache, b telemetry.Binding, findingID string) ([]enrichment.Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT document FROM stream_findings WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND finding_id=$4`, b.TenantID, b.ConnectorID, b.Source, findingID).Scan(&raw); err != nil {
		return nil, err
	}
	var f telemetry.Finding
	if json.Unmarshal(raw, &f) != nil || len(f.EventKeys) != 4 {
		return nil, ErrInvalid
	}
	events := []telemetry.Event{}
	ips := map[string]bool{}
	for _, key := range f.EventKeys {
		var envelope []byte
		var hash string
		if err = tx.QueryRow(ctx, `SELECT envelope,content_hash FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4`, b.TenantID, b.ConnectorID, b.Source, key).Scan(&envelope, &hash); err != nil {
			return nil, err
		}
		e, err := telemetry.Decode(envelope, b)
		if err != nil || e.Identity() != key || e.ContentHash() != hash {
			return nil, ErrInvalid
		}
		events = append(events, e)
		ips[e.Projection.SourceIP] = true
	}
	if f.ValidateEvidence(b, events) != nil {
		return nil, ErrInvalid
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	ordered := []string{}
	for ip := range ips {
		ordered = append(ordered, ip)
	}
	sort.Strings(ordered)
	results := []enrichment.Result{}
	store := enrichment.Store{Pool: pool, Cache: cache}
	for _, ip := range ordered {
		r, err := store.Lookup(ctx, b.TenantID, "ip", ip)
		if err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, nil
}
