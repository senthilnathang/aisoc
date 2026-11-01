package telemetrypipeline

import (
	"aisoc/backend/internal/modules/localintegrations"
	"aisoc/backend/internal/modules/localintegrations/localsql"
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"time"
)

// RunManaged discovers sealed Build profiles under startup-authorized grants.
// It reuses existing durable publication, consumer recovery, correlation, job and
// sync primitives; ten oldest-touched profiles per pass bound local work.
func (r Runtime) RunManaged(ctx context.Context, grants []byte) error {
	q := localsql.New(r.Store.Pool)
	for ctx.Err() == nil {
		rows, err := q.ReadyProfiles(ctx, grants)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			p, e := localintegrations.View(row)
			if e != nil {
				return e
			}
			child := r
			child.Binding = localintegrations.Binding(row.TenantID, row.ID)
			child.Processor = "build-login-v1"
			child.ConsumerName = "build-worker"
			child.RequireAnalystReview = true
			child.MockLoginContext = p.Document.Context
			child.Store.MaxEvents = 1000
			child.Store.MaxPayloadBytes = 16 << 20
			child.MaxEntries = 2000
			pass, cancel := context.WithTimeout(ctx, 5*time.Second)
			noop := func(context.Context, pgx.Tx, telemetry.Event) error { return nil }
			_, e = child.PublishBatch(pass, telemetry.MaxBatchEvents)
			if e == nil {
				e = child.Poll(pass, "filtered", noop)
			}
			if e == nil {
				_, e = child.Recover(pass, "0-0", "filtered", noop)
			}
			if e == nil {
				_, e = child.Reconcile(pass, "")
			}
			if e == nil {
				e = child.AdvanceMock(pass)
			}
			cancel()
			code := ""
			if e != nil {
				code = "PIPELINE_RETRY"
			}
			_, err = r.Store.Pool.Exec(ctx, `INSERT INTO stream_worker_status(tenant_id,connector_id,source,processor,worker_id,error_code) VALUES($1,$2,'qradar-siem','build-login-v1','build-worker',$3) ON CONFLICT(tenant_id,connector_id,source,processor,worker_id) DO UPDATE SET last_seen=now(),error_code=EXCLUDED.error_code`, row.TenantID, row.ID, code)
			if err != nil {
				return err
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return ctx.Err()
}
func ManagedGrants(pairs []map[string]string) []byte { raw, _ := json.Marshal(pairs); return raw }
