package intake

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func findingSetup(t *testing.T) (Store, FindingAdmission, telemetry.Finding) {
	t.Helper()
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "finding-" + jobs.ID()
	cfg := FindingAdmission{Binding: telemetry.Binding{TenantID: tenant, ConnectorID: "mock", Source: "qradar-siem"}, RuleID: "login", MaxActive: 1, MaxRetained: 10}
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'login','{"enabled":true,"routing":"Escalate"}',now())`, tenant); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"stream_findings", "stream_admission_tenants", "skill_applications", "investigation_steps", "case_records", "investigation_jobs", "alerts", "detection_rules", "investigations", "audit_events", "stream_outbox", "stream_events", "stream_source_checkpoints"} {
			if _, err := pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant); err != nil {
				t.Error(err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant); err != nil {
			t.Error(err)
		}
	})
	s := Store{Pool: pool}
	return s, cfg, newFinding(t, s, cfg, "")
}
func newFinding(t *testing.T, s Store, cfg FindingAdmission, suffix string) telemetry.Finding {
	t.Helper()
	ctx := context.Background()
	events, err := qradarmock.LoginPage(cfg.Binding)
	if err != nil {
		t.Fatal(err)
	}
	for i := range events {
		events[i].SourceEventID += suffix
		events[i].EvidenceRef += suffix
	}
	es := eventstate.Store{Pool: s.Pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}
	cp, err := es.Checkpoint(ctx, cfg.Binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = es.Accept(ctx, cfg.Binding, cp, "page"+suffix, events); err != nil {
		t.Fatal(err)
	}
	f, err := telemetry.SuspiciousLogins(cfg.Binding, events, time.Date(2026, 10, 29, 10, 4, 0, 0, time.UTC))
	if err != nil || len(f) != 1 {
		t.Fatal(f, err)
	}
	return f[0]
}
func TestFindingAdmissionConcurrentReplayAndCapacity(t *testing.T) {
	s, cfg, f := findingSetup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	receipts := make(chan FindingReceipt, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); r, e := s.AdmitFinding(ctx, cfg, f); receipts <- r; errs <- e }()
	}
	wg.Wait()
	close(receipts)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	first := ""
	fresh := 0
	for r := range receipts {
		if !r.Duplicate {
			fresh++
		}
		if first == "" {
			first = r.JobID
		}
		if first != r.JobID {
			t.Fatal("duplicate job")
		}
	}
	if fresh != 1 {
		t.Fatal(fresh)
	}
	for _, table := range []string{"stream_findings", "alerts", "investigations", "investigation_jobs"} {
		var n int
		if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", cfg.Binding.TenantID).Scan(&n); err != nil || n != 1 {
			t.Fatal(table, n, err)
		}
	}
	f2 := newFinding(t, s, cfg, "-second")
	if _, err := s.AdmitFinding(ctx, cfg, f2); !errors.Is(err, eventstate.ErrCapacity) {
		t.Fatal("capacity", err)
	}
	for i := 0; i < 3; i++ {
		if ok, err := s.ProcessNext(ctx); err != nil || !ok {
			t.Fatal(ok, err)
		}
	}
	var status, determination string
	if err := s.Pool.QueryRow(ctx, `SELECT status,determination FROM investigations WHERE tenant_id=$1`, cfg.Binding.TenantID).Scan(&status, &determination); err != nil || status != "open" || determination != "suspicious" {
		t.Fatal(status, determination, err)
	}
	if _, err := s.AdmitFinding(ctx, cfg, f2); err != nil {
		t.Fatal("capacity not released", err)
	}
	cfg.MaxRetained = 2
	cfg.MaxActive = 2
	if _, err := s.AdmitFinding(ctx, cfg, newFinding(t, s, cfg, "-third")); !errors.Is(err, eventstate.ErrCapacity) {
		t.Fatal("retention", err)
	}
}
func TestFindingAdmissionRollbackAndValidation(t *testing.T) {
	s, cfg, f := findingSetup(t)
	ctx := context.Background()
	name := pgx.Identifier{"fail_finding_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err := s.Pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`) })
	if _, err := s.Pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON stream_findings FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdmitFinding(ctx, cfg, f); err == nil {
		t.Fatal("survived receipt failure")
	}
	for _, table := range []string{"alerts", "investigations", "investigation_jobs", "stream_findings", "audit_events"} {
		var n int
		if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", cfg.Binding.TenantID).Scan(&n); err != nil || n != 0 {
			t.Fatal("partial commit", table, n, err)
		}
	}
	if _, err := s.Pool.Exec(ctx, `DROP TRIGGER `+name+` ON stream_findings`); err != nil {
		t.Fatal(err)
	}
	forged := f
	forged.TenantID = "foreign"
	if _, err := s.AdmitFinding(ctx, cfg, forged); !errors.Is(err, telemetry.ErrBinding) {
		t.Fatal(err)
	}
	forged = f
	forged.ObservedFrom = "2026-10-29T09:00:00Z"
	if _, err := s.AdmitFinding(ctx, cfg, forged); !errors.Is(err, eventstate.ErrConflict) {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE detection_rules SET document=jsonb_set(document,'{routing}','"Suppress"') WHERE tenant_id=$1`, cfg.Binding.TenantID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdmitFinding(ctx, cfg, f); !errors.Is(err, eventstate.ErrInvalid) {
		t.Fatal("routing", err)
	}
}
func TestFindingTenantScheduling(t *testing.T) {
	a, ac, af := findingSetup(t)
	b, bc, bf := findingSetup(t)
	ctx := context.Background()
	if _, err := a.AdmitFinding(ctx, ac, af); err != nil {
		t.Fatal(err)
	}
	if _, err := b.AdmitFinding(ctx, bc, bf); err != nil {
		t.Fatal(err)
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var first runJob
	if ok, err := claimFindingPhase(ctx, tx, &first); err != nil || !ok {
		t.Fatal(ok, err)
	}
	tx2, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx2.Rollback(ctx)
	var second runJob
	if ok, err := claimFindingPhase(ctx, tx2, &second); err != nil || !ok || second.Tenant == first.Tenant {
		t.Fatal("tenant not isolated", ok, err)
	}
	tx3, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx3.Rollback(ctx)
	if ok, err := claimFindingPhase(ctx, tx3, &runJob{}); err != nil || ok {
		t.Fatal("tenant concurrency cap", ok, err)
	}
	tx3.Rollback(ctx)
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = tx2.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	next, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Rollback(ctx)
	var rotated runJob
	if ok, err := claimFindingPhase(ctx, next, &rotated); err != nil || !ok || rotated.Tenant != first.Tenant {
		t.Fatal("round robin", ok, err)
	}
}

func TestFindingDistinctCapacityRaceAndRevisionConflict(t *testing.T) {
	s, cfg, f := findingSetup(t)
	ctx := context.Background()
	second := newFinding(t, s, cfg, "-second")
	results := make(chan error, 2)
	for _, candidate := range []telemetry.Finding{f, second} {
		go func(candidate telemetry.Finding) { _, err := s.AdmitFinding(ctx, cfg, candidate); results <- err }(candidate)
	}
	success, limited := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			success++
		} else if errors.Is(err, eventstate.ErrCapacity) {
			limited++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || limited != 1 {
		t.Fatal("capacity race", success, limited)
	}
	events, err := qradarmock.LoginPage(cfg.Binding)
	if err != nil {
		t.Fatal(err)
	}
	revised := events[0]
	revised.SourceRevision = "corrected"
	es := eventstate.Store{Pool: s.Pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}
	cp, err := es.Checkpoint(ctx, cfg.Binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = es.Accept(ctx, cfg.Binding, cp, "revision-page", []telemetry.Event{revised}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AdmitFinding(ctx, cfg, f); !errors.Is(err, telemetry.ErrRevisionAmbiguous) {
		t.Fatal("ambiguous accepted revision", err)
	}
}

func TestFindingOrdinaryWorkAndAnalystRetry(t *testing.T) {
	s, cfg, f := findingSetup(t)
	ctx := context.Background()
	receipt, err := s.AdmitFinding(ctx, cfg, f)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := s.IngestOperator(ctx, cfg.Binding.TenantID, AlertInput{Source: "ordinary", ExternalID: "ordinary-1", RuleID: cfg.RuleID, Title: "Ordinary alert", Severity: "high", PrimaryEntity: "user"})
	if err != nil {
		t.Fatal(err)
	}
	alertID := ordinary["alert"].(map[string]any)["id"].(string)
	for i := 0; i < 3; i++ {
		if ok, err := s.ProcessNext(ctx); err != nil || !ok {
			t.Fatal(ok, err)
		}
	}
	var phase int
	if err = s.Pool.QueryRow(ctx, `SELECT phase FROM investigation_jobs WHERE tenant_id=$1 AND alert_id=$2`, cfg.Binding.TenantID, alertID).Scan(&phase); err != nil || phase == 0 {
		t.Fatal("ordinary work starved", phase, err)
	}
	// Finish both local jobs, then use the existing analyst retry entry point.
	for i := 0; i < 3; i++ {
		if ok, err := s.ProcessNext(ctx); err != nil || !ok {
			t.Fatal(ok, err)
		}
	}
	if _, err = (investigations.Store{Pool: s.Pool}).Reinvestigate(ctx, cfg.Binding.TenantID, receipt.InvestigationID); err != nil {
		t.Fatal(err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var retry runJob
	if ok, err := claimFindingPhase(ctx, tx, &retry); err != nil || !ok || retry.ID == receipt.JobID || retry.Case != receipt.InvestigationID {
		t.Fatal("retry bypassed tenant scheduling", retry, ok, err)
	}
}
