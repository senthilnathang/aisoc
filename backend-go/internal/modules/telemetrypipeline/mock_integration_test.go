package telemetrypipeline

import (
	"aisoc/backend/internal/modules/enrichment"
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/eventstate"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"os"
	"reflect"
	"testing"
	"time"
)

// S05/S06 mock transport and durable admission; no external action is performed.
func TestMockQRadarLoginFlow(t *testing.T) {
	r, _, _ := setup(t)
	ctx := context.Background()
	page, err := qradarmock.LoginPage(r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	cp, err := r.Store.Checkpoint(ctx, r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := r.Store.Accept(ctx, r.Binding, cp, "mock-page-1", page)
	if err != nil || accepted.Inserted != 4 {
		t.Fatal(accepted, err)
	}
	duplicate, err := r.Store.Accept(ctx, r.Binding, accepted.Checkpoint, "mock-page-replayed", page)
	if err != nil || duplicate.Inserted != 0 {
		t.Fatal(duplicate, err)
	}
	for i := 0; i < 5; i++ {
		publish(t, r)
	}
	if err = r.Poll(ctx, "filtered", func(context.Context, pgx.Tx, telemetry.Event) error { return nil }); err != nil {
		t.Fatal(err)
	}
	rows, err := r.Store.Pool.Query(ctx, `SELECT e.envelope FROM stream_events e JOIN stream_inbox i USING(tenant_id,connector_id,source,event_key) WHERE e.tenant_id=$1 AND e.connector_id=$2 AND e.source=$3 AND i.processor=$4`, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, r.Processor)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	snapshot := []telemetry.Event{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		e, err := telemetry.Decode(raw, r.Binding)
		if err != nil {
			t.Fatal(err)
		}
		snapshot = append(snapshot, e)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(snapshot) != 5 {
		t.Fatal("missing committed delivery", len(snapshot))
	}
	watermark := time.Date(2026, 10, 29, 10, 4, 0, 0, time.UTC)
	findings, err := telemetry.SuspiciousLogins(r.Binding, snapshot, watermark)
	if err != nil || len(findings) != 1 {
		t.Fatal(findings, err)
	}
	again, err := telemetry.SuspiciousLogins(r.Binding, snapshot, watermark)
	if err != nil || !reflect.DeepEqual(findings, again) {
		t.Fatal("unstable replay", err)
	}
	if pending, err := r.Consumer.Pending(ctx, r.Binding, r.Processor); err != nil || pending != 0 {
		t.Fatal(pending, err)
	}
	if _, err = r.Store.Pool.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'mock-login','{"enabled":true,"routing":"Escalate"}',now())`, r.Binding.TenantID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"stream_findings", "stream_admission_tenants", "skill_applications", "investigation_jobs", "alerts", "detection_rules", "investigations", "audit_events"} {
			if _, err := r.Store.Pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", r.Binding.TenantID); err != nil {
				t.Error(err)
			}
		}
	})
	admission := intake.Store{Pool: r.Store.Pool}
	cfg := intake.FindingAdmission{Binding: r.Binding, RuleID: "mock-login", MaxActive: 1, MaxRetained: 10}
	receipt, err := admission.AdmitFinding(ctx, cfg, findings[0])
	if err != nil || receipt.Duplicate || receipt.JobID == "" {
		t.Fatal(receipt, err)
	}
	replay, err := admission.AdmitFinding(ctx, cfg, findings[0])
	if err != nil || !replay.Duplicate || replay.JobID != receipt.JobID || replay.InvestigationID != receipt.InvestigationID {
		t.Fatal(replay, err)
	}
	task, err := l1.LoadTask(ctx, r.Store.Pool, r.Binding, findings[0].FindingID, "sandbox-task", "sandbox-attempt", time.Now().Add(10*time.Second))
	if err != nil || len(task.Evidence) != 4 || task.IncidentId != receipt.InvestigationID {
		t.Fatal("evidence tool", err)
	}
	foreign := r.Binding
	foreign.TenantID = "other"
	if _, err = l1.LoadTask(ctx, r.Store.Pool, foreign, findings[0].FindingID, "task", "attempt", time.Now().Add(10*time.Second)); err == nil {
		t.Fatal("cross-tenant evidence")
	}
	if _, err = r.Store.Pool.Exec(ctx, `INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES($1,'00000000-0000-4000-8000-000000000099','python.investigate_mock','1','x')`, r.Binding.TenantID); err != nil {
		t.Fatal(err)
	}
	if _, err = l1.QueueMock(ctx, r.Store.Pool, r.Binding, findings[0].FindingID, 1); !errors.Is(err, eventstate.ErrCapacity) {
		t.Fatal("mock task budget", err)
	}
	if _, err = r.Store.Pool.Exec(ctx, `DELETE FROM jobs WHERE tenant_id=$1 AND id='00000000-0000-4000-8000-000000000099'`, r.Binding.TenantID); err != nil {
		t.Fatal(err)
	}
	id, err := l1.QueueMock(ctx, r.Store.Pool, r.Binding, findings[0].FindingID, 1)
	if err != nil {
		t.Fatal(err)
	}
	duplicateID, err := l1.QueueMock(ctx, r.Store.Pool, r.Binding, findings[0].FindingID, 1)
	if err != nil || id != duplicateID {
		t.Fatal("duplicate mock task", duplicateID, err)
	}
	t.Logf("synthetic QRadar: 4 new events, 0 on replay, 1 requires_review finding, %d evidence references, 0 response actions", len(findings[0].EvidenceRefs))
	cache, err := enrichment.NewCache(os.Getenv("AISOC_TEST_REDIS_ADDR"), "aisoc-cache", os.Getenv("AISOC_TEST_REDIS_CACHE_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	defer cache.Close()
	for i := 0; i < 2; i++ {
		contextResults, err := l1.EnrichLogin(ctx, r.Store.Pool, cache, r.Binding, findings[0].FindingID)
		if err != nil || len(contextResults) != 1 || len(contextResults[0].Matches) != 0 {
			t.Fatal("local IOC context", contextResults, err)
		}
		if i == 1 && contextResults[0].CacheStatus != "hit" {
			t.Fatal("repeated context not cached", contextResults)
		}
	}
	if _, err = l1.EnrichLogin(ctx, r.Store.Pool, cache, foreign, findings[0].FindingID); err == nil {
		t.Fatal("foreign enrichment")
	}
}
