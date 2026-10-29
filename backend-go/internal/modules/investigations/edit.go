package investigations

import (
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/legacy"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

// Patch updates only allowlisted columns; incoming field order is retained in the audit.
// Legacy SQLite accepts additional malformed types; this typed repository rejects them.
func (s Store) Patch(ctx context.Context, tenant, id string, fields map[string]json.RawMessage, keys []string) (Record, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx)
	if err = Lock(ctx, tx, tenant, id); err != nil {
		return Record{}, err
	}
	args := []any{tenant, id}
	for _, key := range []string{"status", "determination", "summary", "risk_score", "replay_count"} {
		if _, ok := fields[key]; ok {
			if err = assertEditable(ctx, tx, tenant, id); err != nil {
				return Record{}, err
			}
			break
		}
	}
	sets := []string{}
	auditKeys := []string{}
	bad := func() (Record, error) {
		return Record{}, fault.New(400, "VALIDATION_ERROR", "Invalid investigation fields.")
	}
	for _, key := range keys {
		if key != "secret" {
			auditKeys = append(auditKeys, key)
		}
		raw := fields[key]
		var value any
		switch key {
		case "title", "summary", "source", "category", "severity", "status", "determination", "owner", "primary_entity":
			text, err := legacy.Text(raw)
			if err != nil {
				return bad()
			}
			if key == "severity" && !contains([]string{"low", "medium", "high", "critical"}, text) {
				return bad()
			}
			if key == "status" && !contains([]string{"open", "investigating", "contained", "resolved", "closed"}, text) {
				return bad()
			}
			if key == "determination" && !contains([]string{"unknown", "benign", "suspicious", "malicious", "mitigated"}, text) {
				return bad()
			}
			value = text
		case "risk_score", "replay_count":
			n, err := legacy.Integer(raw)
			if err != nil {
				return bad()
			}
			if key == "risk_score" && (n < 0 || n > 100) {
				return bad()
			}
			value = n
		case "insight_refs":
			var refs []string
			if string(raw) == "null" || json.Unmarshal(raw, &refs) != nil {
				return bad()
			}
			value = raw
		default:
			continue
		}
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s=$%d", key, len(args)))
	}
	query := `SELECT ` + columns + ` FROM investigations WHERE tenant_id=$1 AND id=$2`
	if len(sets) > 0 {
		args = append(args, time.Now().UTC().Truncate(time.Millisecond))
		sets = append(sets, fmt.Sprintf("updated_at=$%d", len(args)))
		query = `UPDATE investigations SET ` + strings.Join(sets, ",") + ` WHERE tenant_id=$1 AND id=$2 RETURNING ` + columns
	}
	rawAudit, err := json.Marshal(map[string]any{"fields": auditKeys})
	if err != nil {
		return Record{}, err
	}
	// Keep the case lock and atomic audit, but send the write and its audit in
	// one exchange. Close the batch before committing or rolling back the tx.
	batch := &pgx.Batch{}
	batch.Queue(query, args...)
	batch.Queue(auditInsert, tenant, jobs.ID(), "investigations", id, "updated", rawAudit, time.Now().UTC().Truncate(time.Millisecond))
	results := tx.SendBatch(ctx, batch)
	result, err := scan(results.QueryRow())
	if err != nil {
		results.Close()
		return Record{}, err
	}
	if err = results.Close(); err != nil {
		return Record{}, err
	}
	return result, tx.Commit(ctx)
}
