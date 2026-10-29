package migration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"strings"
)

type Snapshot struct {
	Format int              `json:"format_version"`
	Schema []Row            `json:"schema"`
	Tables map[string][]Row `json:"tables"`
}
type Report struct {
	Hash            string         `json:"snapshot_hash"`
	Counts          map[string]int `json:"counts"`
	AlreadyImported bool           `json:"already_imported"`
}

func Import(ctx context.Context, pool *pgxpool.Pool, raw, key []byte) (Report, error) {
	var source Snapshot
	report := Report{Counts: map[string]int{}}
	if err := json.Unmarshal(raw, &source); err != nil {
		return report, fmt.Errorf("invalid snapshot JSON")
	}
	if source.Format != 1 {
		return report, fmt.Errorf("unsupported snapshot version")
	}
	allowed := map[string]bool{"schema_migrations": true}
	for _, name := range order {
		allowed[name] = true
	}
	for name := range source.Tables {
		if !allowed[name] {
			return report, fmt.Errorf("unsupported source table %s", name)
		}
	}
	for name := range allowed {
		if _, ok := source.Tables[name]; !ok {
			return report, fmt.Errorf("snapshot missing table %s", name)
		}
	}
	sum := sha256.Sum256(raw)
	report.Hash = hex.EncodeToString(sum[:])
	tx, err := pool.Begin(ctx)
	if err != nil {
		return report, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(714203002)`); err != nil {
		return report, err
	}
	var imported bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM migration_imports WHERE snapshot_hash=$1)`, report.Hash).Scan(&imported); err != nil {
		return report, err
	}
	if imported {
		report.AlreadyImported = true
		return report, tx.Commit(ctx)
	}
	var n int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM tenants`).Scan(&n); err != nil {
		return report, err
	}
	if n != 0 {
		return report, fmt.Errorf("import requires an empty target; existing tenants found")
	}
	versions := map[string]any{}
	for _, r := range source.Tables["detection_rule_versions"] {
		key := fmt.Sprint(r["tenant_id"]) + "\x00" + fmt.Sprint(r["rule_id"])
		v := r["version"].(float64)
		prior, _ := versions[key].(float64)
		if v > prior {
			versions[key] = v
		}
	}
	tenants := map[string]bool{}
	for _, rows := range source.Tables {
		for _, r := range rows {
			if tenant, ok := r["tenant_id"].(string); ok {
				tenants[tenant] = true
			}
		}
	}
	for tenant := range tenants {
		if _, err = tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
			return report, fmt.Errorf("tenant import failed")
		}
	}
	for _, name := range order {
		for index, r := range source.Tables[name] {
			converted, e := forward(name, r, key, versions)
			if e != nil {
				return report, fmt.Errorf("conversion failed for %s row %d: %w", name, index, e)
			}
			names := []string{}
			for k := range converted {
				names = append(names, k)
			}
			sort.Strings(names)
			quoted := []string{}
			for _, k := range names {
				quoted = append(quoted, pgx.Identifier{k}.Sanitize())
			}
			table := pgx.Identifier{target(name)}.Sanitize()
			fields := strings.Join(quoted, ",")
			if _, err = tx.Exec(ctx, "INSERT INTO "+table+"("+fields+") SELECT "+fields+" FROM jsonb_populate_record(NULL::"+table+",$1::jsonb)", converted); err != nil {
				return report, fmt.Errorf("database rejected %s row %d (no rows committed)", name, index)
			}
		}
		report.Counts[name] = len(source.Tables[name])
	}
	metadata := Snapshot{Format: 1, Schema: source.Schema, Tables: map[string][]Row{"schema_migrations": source.Tables["schema_migrations"]}}
	if _, err = tx.Exec(ctx, `INSERT INTO migration_imports(snapshot_hash,metadata) VALUES($1,$2)`, report.Hash, metadata); err != nil {
		return report, err
	}
	return report, tx.Commit(ctx)
}
func Export(ctx context.Context, pool *pgxpool.Pool, key []byte) (Snapshot, error) {
	var output Snapshot
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return output, err
	}
	defer tx.Rollback(ctx)
	var metadata []byte
	if err = tx.QueryRow(ctx, `SELECT metadata FROM migration_imports ORDER BY imported_at DESC LIMIT 1`).Scan(&metadata); err != nil {
		return output, fmt.Errorf("export requires a recorded legacy import")
	}
	if err = json.Unmarshal(metadata, &output); err != nil {
		return output, err
	}
	var jobs int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM jobs`).Scan(&jobs); err != nil {
		return output, err
	}
	if jobs > 0 {
		return output, fmt.Errorf("legacy rollback cannot represent specialist job records; export refused")
	}
	for _, name := range order {
		table := pgx.Identifier{target(name)}.Sanitize()
		query := "SELECT to_jsonb(t) FROM " + table + " t"
		if name == "artifacts" {
			query += " WHERE kind='artifacts'"
		}
		if name == "investigation_feedback" {
			query += " WHERE kind='feedback'"
		}
		// Identity order preserves legacy rowid tie semantics across snapshots.
		if name != "response_plan_versions" && name != "detection_rule_versions" && name != "skill_material_versions" && name != "case_runbook_events" {
			query += " ORDER BY ordinal"
		} else {
			query += " ORDER BY version"
		}
		rows, e := tx.Query(ctx, query)
		if e != nil {
			return output, e
		}
		output.Tables[name] = []Row{}
		for rows.Next() {
			var stored Row
			if err = rows.Scan(&stored); err != nil {
				rows.Close()
				return output, err
			}
			r, e := backward(name, stored, key)
			if e != nil {
				rows.Close()
				return output, e
			}
			output.Tables[name] = append(output.Tables[name], r)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return output, err
		}
	}
	return output, tx.Commit(ctx)
}
