package soarsync

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func setup(t *testing.T) (Store, string, string, string, qradarmock.CaseRevision) {
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
	tenant := "soar-" + jobs.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"mock_soar_notes", "l1_escalations", "mock_soar_cases", "case_records", "stream_findings", "stream_admission_tenants", "investigation_jobs", "alerts", "detection_rules", "investigations", "audit_events", "jobs", "stream_outbox", "stream_events", "stream_source_checkpoints"} {
			if _, err := pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant); err != nil {
				t.Error(err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant); err != nil {
			t.Error(err)
		}
	})
	if _, err = pool.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'mock-login','{"enabled":true,"routing":"Escalate"}',now())`, tenant); err != nil {
		t.Fatal(err)
	}
	b := telemetry.Binding{TenantID: tenant, ConnectorID: "siem", Source: "qradar-siem"}
	events, err := qradarmock.LoginPage(b)
	if err != nil {
		t.Fatal(err)
	}
	es := eventstate.Store{Pool: pool, MaxEvents: 100, MaxPayloadBytes: 1 << 20}
	if _, err = es.Accept(ctx, b, eventstate.Checkpoint{}, "page", events); err != nil {
		t.Fatal(err)
	}
	findings, err := telemetry.SuspiciousLogins(b, events, time.Date(2026, 10, 29, 10, 4, 0, 0, time.UTC))
	if err != nil || len(findings) != 1 {
		t.Fatal(findings, err)
	}
	receipt, err := (intake.Store{Pool: pool}).AdmitFinding(ctx, intake.FindingAdmission{Binding: b, RuleID: "mock-login", MaxActive: 1, MaxRetained: 10}, findings[0])
	if err != nil {
		t.Fatal(err)
	}
	id, err := l1.QueueMock(ctx, pool, b, findings[0].FindingID, 1)
	if err != nil {
		t.Fatal(err)
	}
	js := jobs.Store{Pool: pool, Plugins: []string{l1.Plugin}}
	request, err := js.Claim(ctx)
	if err != nil || request == nil || request.JobId != id {
		t.Fatal(request, err)
	}
	var task pb.InvestigationTask
	if proto.Unmarshal(request.Input, &task) != nil {
		t.Fatal("input")
	}
	task.AttemptId = request.AttemptId
	task.DeadlineUnixMs = time.Now().Add(5 * time.Second).UnixMilli()
	refs := []string{}
	for _, e := range task.Evidence {
		refs = append(refs, e.Reference)
	}
	result := &pb.InvestigationResult{TenantId: tenant, IncidentId: receipt.InvestigationID, TaskId: id, AttemptId: request.AttemptId, SchemaVersion: "1", Verdict: "INCONCLUSIVE", RequiresHumanReview: true, ModelVersion: "deterministic-mock-v1", MissingEvidence: []string{"iam_mfa_context", "endpoint_process_tree"}, Hypotheses: []*pb.Hypothesis{{Kind: "credential_compromise", SupportingRefs: refs}, {Kind: "legitimate_user_or_automation", SupportingRefs: refs}}}
	if err = l1.VerifyResult(&task, result, time.Now()); err != nil {
		t.Fatal(err)
	}
	output, _ := proto.Marshal(result)
	if err = js.Complete(ctx, request, output); err != nil {
		t.Fatal(err)
	}
	s := Store{Pool: pool}
	revision := qradarmock.CaseRevision{Binding: telemetry.Binding{TenantID: tenant, ConnectorID: "soar", Source: "qradar-soar"}, ExternalID: "case-1", Version: "v1", Status: "open"}
	if err = s.ObserveMockCase(ctx, revision, "analyst-a", "analyst original note"); err != nil {
		t.Fatal(err)
	}
	return s, tenant, id, receipt.InvestigationID, revision
}
func target(r qradarmock.CaseRevision) Target {
	return Target{r.Binding.ConnectorID, r.ExternalID, r.Version}
}

func TestEscalationAndNoteConcurrentReplay(t *testing.T) {
	s, tenant, id, incident, revision := setup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Stage(ctx, tenant, id, target(revision)); errs <- err }()
	}
	wg.Wait()
	for i := 0; i < 8; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.SyncMock(ctx, tenant, id); errs <- err }()
	}
	wg.Wait()
	for i := 0; i < 8; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"l1_escalations", "mock_soar_notes", "case_records"} {
		var n int
		if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", tenant).Scan(&n); err != nil || n != 1 {
			t.Fatal(table, n, err)
		}
	}
	var status, owner string
	if err := s.Pool.QueryRow(ctx, `SELECT status,owner FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, incident).Scan(&status, &owner); err != nil || status != "open" || owner != "Analyst review" {
		t.Fatal(status, owner, err)
	}
	r, err := s.Stage(ctx, tenant, id, target(revision))
	if err != nil || r.State != "synced" || r.NoteID == "" {
		t.Fatal(r, err)
	}
	if _, err = s.Stage(ctx, "foreign", id, target(revision)); err == nil {
		t.Fatal("foreign job")
	}
	other := target(revision)
	other.ExternalID = "other"
	if _, err = s.Stage(ctx, tenant, id, other); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
func TestConflictRebaseAndAnalystPreservation(t *testing.T) {
	s, tenant, id, _, revision := setup(t)
	ctx := context.Background()
	if _, err := s.Stage(ctx, tenant, id, target(revision)); err != nil {
		t.Fatal(err)
	}
	newer := revision
	newer.PreviousVersion = "v1"
	newer.Version = "analyst-v2"
	newer.Status = "closed"
	if err := s.ObserveMockCase(ctx, newer, "analyst-b", "preserve this update"); err != nil {
		t.Fatal(err)
	}
	if r, err := s.SyncMock(ctx, tenant, id); !errors.Is(err, ErrConflict) || r.State != "conflict" {
		t.Fatal(r, err)
	}
	if _, err := s.SyncMock(ctx, tenant, id); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if err := s.RebaseMock(ctx, tenant, id, "v1", "reviewer"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if err := s.RebaseMock(ctx, tenant, id, newer.Version, "reviewer"); err != nil {
		t.Fatal(err)
	}
	r, err := s.SyncMock(ctx, tenant, id)
	if err != nil || r.State != "synced" {
		t.Fatal(r, err)
	}
	var owner, note string
	echo := newer
	if err = s.Pool.QueryRow(ctx, `SELECT version,previous_version,status,owner,analyst_note FROM mock_soar_cases WHERE tenant_id=$1`, tenant).Scan(&echo.Version, &echo.PreviousVersion, &echo.Status, &owner, &note); err != nil {
		t.Fatal(err)
	}
	if owner != "analyst-b" || note != "preserve this update" || echo.Status != "closed" {
		t.Fatal("analyst updates overwritten", owner, note, echo.Status)
	}
	if err = s.ObserveMockCase(ctx, echo, owner, note); err != nil {
		t.Fatal("sync echo", err)
	}
	reopened := echo
	reopened.PreviousVersion = echo.Version
	reopened.Version = "reopen-1"
	reopened.Status = "reopened"
	if err = s.ObserveMockCase(ctx, reopened, owner, note); err != nil {
		t.Fatal(err)
	}
	if err = s.ObserveMockCase(ctx, newer, owner, note); err == nil {
		t.Fatal("stale snapshot accepted")
	}
	var n int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM mock_soar_notes WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
}
func TestAuditFailureRollsBackEscalationAndSync(t *testing.T) {
	s, tenant, id, _, revision := setup(t)
	ctx := context.Background()
	name := pgx.Identifier{"fail_soar_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err := s.Pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action IN ('l1_review_required','mock_soar_note_synced') THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`) })
	trigger := func() {
		t.Helper()
		if _, err := s.Pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`()`); err != nil {
			t.Fatal(err)
		}
	}
	drop := func() {
		t.Helper()
		if _, err := s.Pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
			t.Fatal(err)
		}
	}
	trigger()
	if _, err := s.Stage(ctx, tenant, id, target(revision)); err == nil {
		t.Fatal("audit failure accepted")
	}
	for _, table := range []string{"l1_escalations", "case_records"} {
		var n int
		if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", tenant).Scan(&n); err != nil || n != 0 {
			t.Fatal(n, err)
		}
	}
	drop()
	if _, err := s.Stage(ctx, tenant, id, target(revision)); err != nil {
		t.Fatal(err)
	}
	trigger()
	if _, err := s.SyncMock(ctx, tenant, id); err == nil {
		t.Fatal("sync audit failure accepted")
	}
	var version string
	var n int
	if err := s.Pool.QueryRow(ctx, `SELECT version FROM mock_soar_cases WHERE tenant_id=$1`, tenant).Scan(&version); err != nil || version != "v1" {
		t.Fatal(version, err)
	}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM mock_soar_notes WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 0 {
		t.Fatal(n, err)
	}
	drop()
	if _, err := s.SyncMock(ctx, tenant, id); err != nil {
		t.Fatal(err)
	}
}

func TestEscalationRejectsUnfinishedAndInvalidResults(t *testing.T) {
	s, tenant, id, _, revision := setup(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `UPDATE jobs SET state='cancelled' WHERE tenant_id=$1 AND id=$2`, tenant, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Stage(ctx, tenant, id, target(revision)); err == nil {
		t.Fatal("cancelled output staged")
	}
	var raw []byte
	if err := s.Pool.QueryRow(ctx, `UPDATE jobs SET state='completed' WHERE tenant_id=$1 AND id=$2 RETURNING output`, tenant, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var result pb.InvestigationResult
	if proto.Unmarshal(raw, &result) != nil {
		t.Fatal("output")
	}
	for _, mutate := range []func(*pb.InvestigationResult){
		func(r *pb.InvestigationResult) { r.AttemptId = jobs.ID() },
		func(r *pb.InvestigationResult) { r.Verdict = "BENIGN" },
		func(r *pb.InvestigationResult) { r.Hypotheses[0].SupportingRefs = []string{"invented"} },
	} {
		bad := proto.Clone(&result).(*pb.InvestigationResult)
		mutate(bad)
		badRaw, _ := proto.Marshal(bad)
		if _, err := s.Pool.Exec(ctx, `UPDATE jobs SET output=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, badRaw); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Stage(ctx, tenant, id, target(revision)); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid output staged", err)
		}
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE jobs SET output=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, raw); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Stage(ctx, tenant, id, target(revision)); err != nil {
		t.Fatal(err)
	}
	if err := s.ObserveMockCase(ctx, revision, "changed without revision", "analyst original note"); !errors.Is(err, ErrConflict) {
		t.Fatal("same-version edit", err)
	}
}
