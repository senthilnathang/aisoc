package soarsync

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"errors"
	"testing"
)

func TestReviewRequiredBeforeMockNote(t *testing.T) {
	s, tenant, job, _, revision := setup(t)
	ctx := context.Background()
	target := Target{ConnectorID: revision.Binding.ConnectorID, ExternalID: revision.ExternalID, Version: revision.Version, RequireReview: true}
	if _, err := s.Stage(ctx, tenant, job, target); err != nil {
		t.Fatal(err)
	}
	receipt, err := s.SyncMock(ctx, tenant, job)
	if err != nil || receipt.State != "awaiting_review" {
		t.Fatal(receipt, err)
	}
	var n int
	s.Pool.QueryRow(ctx, `SELECT count(*) FROM mock_soar_notes WHERE tenant_id=$1`, tenant).Scan(&n)
	if n != 0 {
		t.Fatal("note before review")
	}
	b := telemetry.Binding{TenantID: tenant, ConnectorID: "siem", Source: "qradar-siem"}
	foreign := b
	foreign.ConnectorID = "wrong"
	if err = s.ApproveMockNote(ctx, foreign, job, "analyst", "Reviewed sandbox evidence"); err == nil {
		t.Fatal("foreign source approved")
	}
	if err = s.ApproveMockNote(ctx, b, job, "analyst", "Reviewed sandbox evidence"); err != nil {
		t.Fatal(err)
	}
	if err = s.ApproveMockNote(ctx, b, job, "analyst", "Reviewed sandbox evidence"); err != nil {
		t.Fatal("replay", err)
	}
	if err = s.ApproveMockNote(ctx, b, job, "other", "Different review comment"); !errors.Is(err, ErrConflict) {
		t.Fatal("overwrite", err)
	}
	receipt, err = s.SyncMock(ctx, tenant, job)
	if err != nil || receipt.State != "synced" {
		t.Fatal(receipt, err)
	}
	receipt, err = s.SyncMock(ctx, tenant, job)
	if err != nil || receipt.State != "synced" {
		t.Fatal(receipt, err)
	}
	s.Pool.QueryRow(ctx, `SELECT count(*) FROM mock_soar_notes WHERE tenant_id=$1`, tenant).Scan(&n)
	if n != 1 {
		t.Fatal("duplicate notes", n)
	}
}

func TestReviewAuditFailureAndGateDowngrade(t *testing.T) {
	s, tenant, job, _, revision := setup(t)
	ctx := context.Background()
	target := Target{ConnectorID: revision.Binding.ConnectorID, ExternalID: revision.ExternalID, Version: revision.Version, RequireReview: true}
	if _, err := s.Stage(ctx, tenant, job, target); err != nil {
		t.Fatal(err)
	}
	weaker := target
	weaker.RequireReview = false
	if _, err := s.Stage(ctx, tenant, job, weaker); !errors.Is(err, ErrConflict) {
		t.Fatal("gate downgrade", err)
	}
	b := telemetry.Binding{TenantID: tenant, ConnectorID: "siem", Source: "qradar-siem"}
	if err := s.ApproveMockNote(ctx, b, job, "analyst", "short"); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	foreign := b
	foreign.TenantID += "-foreign"
	if err := s.ApproveMockNote(ctx, foreign, job, "analyst", "Reviewed evidence safely"); err == nil {
		t.Fatal("foreign tenant approved")
	}
	_, err := s.Pool.Exec(ctx, `CREATE OR REPLACE FUNCTION fail_mock_note_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='mock_soar_note_approved' THEN RAISE EXCEPTION 'review audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_mock_note_review BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_mock_note_review()`)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Pool.Exec(ctx, `DROP TRIGGER IF EXISTS fail_mock_note_review ON audit_events; DROP FUNCTION IF EXISTS fail_mock_note_review()`)
	if err = s.ApproveMockNote(ctx, b, job, "analyst", "Reviewed evidence safely"); err == nil {
		t.Fatal("audit failure ignored")
	}
	var approved bool
	if err = s.Pool.QueryRow(ctx, `SELECT reviewed_by IS NOT NULL FROM l1_escalations WHERE tenant_id=$1 AND job_id=$2`, tenant, job).Scan(&approved); err != nil || approved {
		t.Fatal("partial review", approved, err)
	}
}
