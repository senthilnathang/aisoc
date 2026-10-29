package telemetrypipeline

import (
	"context"
	"errors"
	"net/netip"
	"time"

	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/modules/soarsync"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/eventstate"
	"github.com/jackc/pgx/v5"
)

// AdvanceMock is a bounded sandbox correlation/admission/sync pass. JSON intake
// is capped at 1,000 retained events, so its full mock correlation window is explicit.
// Python work uses the existing durable specialist dispatcher and typed gRPC.
func (r Runtime) AdvanceMock(ctx context.Context) error {
	rows, err := r.Store.Pool.Query(ctx, `SELECT e.envelope FROM stream_events e JOIN stream_inbox i USING(tenant_id,connector_id,source,event_key) WHERE e.tenant_id=$1 AND e.connector_id=$2 AND e.source=$3 AND i.processor=$4 AND NOT EXISTS(SELECT 1 FROM stream_event_archives a WHERE a.tenant_id=e.tenant_id AND a.connector_id=e.connector_id AND a.source=e.source AND a.event_key=e.event_key) ORDER BY e.created_at,e.event_key LIMIT $5`, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, r.Processor, r.Store.MaxEvents+1)
	if err != nil {
		return err
	}
	events := []telemetry.Event{}
	watermark := time.Time{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			break
		}
		var e telemetry.Event
		e, err = telemetry.Decode(raw, r.Binding)
		if err != nil {
			break
		}
		events = append(events, e)
		at, _ := time.Parse(time.RFC3339, e.EventTime)
		if at.After(watermark) {
			watermark = at
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	if int64(len(events)) > r.Store.MaxEvents {
		return eventstate.ErrCapacity
	}
	if len(events) == 0 {
		return nil
	}
	// Correlator's 100-event bound applies to an entity window, not the whole
	// source. Preserve canonical IP grouping and never silently truncate a group.
	type entity struct{ principal, asset, ip string }
	groups := map[entity][]telemetry.Event{}
	revisions := map[string]string{}
	for _, e := range events {
		if prior, ok := revisions[e.SourceEventID]; ok && prior != e.Identity() {
			return telemetry.ErrRevisionAmbiguous
		}
		revisions[e.SourceEventID] = e.Identity()
		ip, _ := netip.ParseAddr(e.Projection.SourceIP)
		key := entity{e.Projection.PrincipalRef, e.Projection.AssetRef, ip.Unmap().String()}
		groups[key] = append(groups[key], e)
	}
	findings := []telemetry.Finding{}
	for _, group := range groups {
		if len(group) > 100 {
			return eventstate.ErrCapacity
		}
		found, err := telemetry.SuspiciousLogins(r.Binding, group, watermark.Add(time.Minute))
		if err != nil {
			return err
		}
		findings = append(findings, found...)
	}
	if len(findings) > 25 {
		return eventstate.ErrCapacity
	}
	if _, err = r.Store.Pool.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'mock-stream-login','{"enabled":true,"routing":"Escalate"}',now()) ON CONFLICT DO NOTHING`, r.Binding.TenantID); err != nil {
		return err
	}
	for _, f := range findings {
		receipt, err := (intake.Store{Pool: r.Store.Pool}).AdmitFinding(ctx, intake.FindingAdmission{Binding: r.Binding, RuleID: "mock-stream-login", MaxActive: 25, MaxRetained: 1000}, f)
		if err != nil {
			return err
		}
		id, err := l1.QueueMock(ctx, r.Store.Pool, r.Binding, f.FindingID, 25)
		if err != nil {
			return err
		}
		var state string
		if err = r.Store.Pool.QueryRow(ctx, `SELECT state FROM jobs WHERE tenant_id=$1 AND id=$2`, r.Binding.TenantID, id).Scan(&state); err != nil {
			return err
		}
		if state != "completed" {
			continue
		}
		target := soarsync.Target{ConnectorID: "mock-soar", ExternalID: receipt.InvestigationID, Version: "1"}
		if _, err = r.Store.Pool.Exec(ctx, `INSERT INTO mock_soar_cases(tenant_id,connector_id,external_id,version,status,owner) VALUES($1,$2,$3,'1','open','sandbox-analyst') ON CONFLICT DO NOTHING`, r.Binding.TenantID, target.ConnectorID, target.ExternalID); err != nil {
			return err
		}
		sync := soarsync.Store{Pool: r.Store.Pool}
		if _, err = sync.Stage(ctx, r.Binding.TenantID, id, target); err != nil {
			return err
		}
		if _, err = sync.SyncMock(ctx, r.Binding.TenantID, id); err != nil {
			return err
		}
	}
	return nil
}

// RunMock schedules a single bounded source. It never contacts a vendor or runs
// a response action. Transient errors remain durable and are retried on later passes.
func (r Runtime) RunMock(ctx context.Context) error {
	if err := r.validate(); err != nil {
		return err
	}
	noop := func(context.Context, pgx.Tx, telemetry.Event) error { return nil }
	claimCursor, reconcileCursor := "0-0", ""
	maintenance := time.Time{}
	lastVersion := int64(-1)
	investigationPending := true
	for ctx.Err() == nil {
		published, publishErr := r.PublishBatch(ctx, 25)
		pollErr := r.Poll(ctx, "filtered", noop)
		var maintenanceErr error
		if time.Since(maintenance) >= time.Second {
			maintenance = time.Now()
			claimCursor, maintenanceErr = r.Recover(ctx, claimCursor, "filtered", noop)
			if maintenanceErr == nil {
				reconcileCursor, maintenanceErr = r.Reconcile(ctx, reconcileCursor)
			}
			if maintenanceErr == nil {
				cp, err := r.Store.Checkpoint(ctx, r.Binding)
				maintenanceErr = err
				if err == nil && (cp.Version != lastVersion || investigationPending) {
					maintenanceErr = r.AdvanceMock(ctx)
					if maintenanceErr == nil {
						lastVersion = cp.Version
						maintenanceErr = r.Store.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_events e WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND NOT EXISTS(SELECT 1 FROM stream_inbox i WHERE i.tenant_id=e.tenant_id AND i.connector_id=e.connector_id AND i.source=e.source AND i.event_key=e.event_key AND i.processor=$4)) OR EXISTS(SELECT 1 FROM stream_findings f WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND NOT EXISTS(SELECT 1 FROM l1_escalations e WHERE e.tenant_id=f.tenant_id AND e.investigation_id=f.investigation_id AND e.state='synced'))`, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, r.Processor).Scan(&investigationPending)
					}
				}
			}
			code := ""
			if errors.Join(publishErr, pollErr, maintenanceErr) != nil {
				code = "PIPELINE_RETRY"
			}
			_, err := r.Store.Pool.Exec(ctx, `INSERT INTO stream_worker_status(tenant_id,connector_id,source,processor,worker_id,error_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,connector_id,source,processor,worker_id) DO UPDATE SET last_seen=now(),error_code=EXCLUDED.error_code`, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, r.Processor, r.ConsumerName, code)
			if err != nil && ctx.Err() == nil {
				return err
			}
		}
		wait := 20 * time.Millisecond
		if published == 0 && !investigationPending {
			wait = 200 * time.Millisecond
		}
		if errors.Join(publishErr, pollErr, maintenanceErr) != nil {
			wait = time.Second
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
	return ctx.Err()
}
