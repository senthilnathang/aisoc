package telemetrypipeline

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/logincontext"
	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestPhishingScopeDoesNotAppendLoginContext(t *testing.T) {
	r, _, _ := setup(t)
	ctx := context.Background()
	t.Cleanup(func() {
		for _, table := range []string{"stream_findings", "stream_admission_tenants", "skill_applications", "investigation_jobs", "alerts", "detection_rules", "investigations", "audit_events"} {
			if _, err := r.Store.Pool.Exec(ctx, `DELETE FROM `+table+` WHERE tenant_id=$1`, r.Binding.TenantID); err != nil {
				t.Error(err)
			}
		}
	})
	r.MockLoginContext = &logincontext.Bundle{SchemaVersion: "1", TenantID: r.Binding.TenantID, PrincipalRef: "mock-user", AssetRef: "mock-device", MaxAgeSeconds: 300, IAM: []logincontext.Observation{{ConnectorID: "iam", Reference: "iam:one", ObservedAt: "2026-10-29T10:02:00Z", RetrievedAt: "2026-10-29T10:04:00Z", Outcome: "passed"}}}
	events, err := qradarmock.PhishingPage(r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	cp, err := r.Store.Checkpoint(ctx, r.Binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.Store.Accept(ctx, r.Binding, cp, "phishing-page", events); err != nil {
		t.Fatal(err)
	}
	if _, err = r.PublishBatch(ctx, 20); err != nil {
		t.Fatal(err)
	}
	if err = r.Poll(ctx, "filtered", func(context.Context, pgx.Tx, telemetry.Event) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err = r.AdvanceMock(ctx); err != nil {
		t.Fatalf("login-only context blocked phishing task: %v", err)
	}
	if err = r.AdvanceMock(ctx); err != nil {
		t.Fatal("replay", err)
	}
	var raw []byte
	if err = r.Store.Pool.QueryRow(ctx, `SELECT input FROM jobs WHERE tenant_id=$1 AND plugin_id='python.investigate_mock'`, r.Binding.TenantID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var task pb.InvestigationTask
	if err = proto.Unmarshal(raw, &task); err != nil {
		t.Fatal(err)
	}
	if len(task.Evidence) != 4 {
		t.Fatal("unexpected context", len(task.Evidence))
	}
	for _, e := range task.Evidence {
		if e.Context != nil || !telemetry.IsPhishingEvent(e.EventType) {
			t.Fatal("login context leaked into phishing")
		}
	}
	var count int
	if err = r.Store.Pool.QueryRow(ctx, `SELECT count(*) FROM stream_findings WHERE tenant_id=$1`, r.Binding.TenantID).Scan(&count); err != nil || count != 1 {
		t.Fatal("finding replay", count, err)
	}
}
