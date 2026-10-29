package l1

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

// LoadTask is a read-only Go evidence adapter scoped by trusted control-plane
// binding and admitted finding. It returns metadata, never raw logs or credentials.
// Caller owns durable task/attempt IDs and deadline; this function is not a scheduler.
func LoadTask(ctx context.Context, pool *pgxpool.Pool, b telemetry.Binding, findingID, taskID, attemptID string, deadline time.Time) (*pb.InvestigationTask, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	var incident string
	if err = tx.QueryRow(ctx, `SELECT document,investigation_id FROM stream_findings WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND finding_id=$4`, b.TenantID, b.ConnectorID, b.Source, findingID).Scan(&raw, &incident); err != nil {
		return nil, err
	}
	var f telemetry.Finding
	if json.Unmarshal(raw, &f) != nil || len(f.EventKeys) != 4 {
		return nil, ErrInvalid
	}
	t := &pb.InvestigationTask{TenantId: b.TenantID, IncidentId: incident, TaskId: taskID, AttemptId: attemptID, SchemaVersion: "1", DeadlineUnixMs: deadline.UnixMilli(), MaxOutputBytes: 8192, Mode: Mode}
	events := []telemetry.Event{}
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
		t.Evidence = append(t.Evidence, &pb.EvidenceItem{Reference: e.EvidenceRef, ContentHash: hash, EventTime: e.EventTime, EventType: e.EventType})
	}
	if f.ValidateEvidence(b, events) != nil || ValidateTask(t, time.Now()) != nil {
		return nil, ErrInvalid
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
}
