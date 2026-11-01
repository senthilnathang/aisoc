package detection

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestCaseFeedbackToRecommendationReplayAndApply(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	pool, e := database.Open(ctx, url, 6)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if e = database.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	tenant := "case-feedback-" + jobs.ID()
	s := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	defer func() {
		for _, table := range []string{"detection_rule_recommendations", "detection_alert_labels", "alerts", "detection_rules", "investigations", "audit_events", "tenants"} {
			col := "tenant_id"
			if table == "tenants" {
				col = "id"
			}
			if _, e := pool.Exec(ctx, "DELETE FROM "+table+" WHERE "+col+"=$1", tenant); e != nil {
				t.Error(e)
			}
		}
	}()
	c, e := cases.Create(ctx, tenant, investigations.Input{Title: "Reviewed mock case", Source: "local-json", Severity: "medium", Status: "resolved", Determination: "benign"})
	if e != nil {
		t.Fatal(e)
	}
	other, e := cases.Create(ctx, tenant, investigations.Input{Title: "Other case", Source: "local-json", Severity: "medium", Status: "open", Determination: "unknown"})
	if e != nil {
		t.Fatal(e)
	}
	rule, e := s.Create(ctx, tenant, map[string]any{"name": "Local feedback rule", "enabled": false, "severity": "high"})
	if e != nil {
		t.Fatal(e)
	}
	rid := rule["id"].(string)
	for _, a := range []struct{ id, source, entity, caseID string }{{"fp", "scanner", "scan", c.ID}, {"tp", "edr", "host", c.ID}, {"unreviewed", "iam", "user", c.ID}, {"other", "scanner", "other", other.ID}} {
		raw, _ := json.Marshal(map[string]any{"title": a.id, "severity": "high", "payload": map[string]any{"primary_entity": a.entity, "summary": "Synthetic source evidence"}})
		_, e = pool.Exec(ctx, `INSERT INTO alerts(tenant_id,id,source,external_id,rule_id,investigation_id,document,payload_hash,created_at) VALUES($1,$2,$3,$2,$4,$5,$6,decode(repeat('00',32),'hex'),now())`, tenant, a.id, a.source, rid, a.caseID, raw)
		if e != nil {
			t.Fatal(e)
		}
	}
	w, e := s.CaseFeedback(ctx, tenant, c.ID, 2, 0)
	if e != nil || w["total"] != int64(3) || len(w["items"].([]json.RawMessage)) != 2 {
		t.Fatal(w, e)
	}
	next, e := s.CaseFeedback(ctx, tenant, c.ID, 2, 2)
	if e != nil || len(next["items"].([]json.RawMessage)) != 1 {
		t.Fatal(next, e)
	}
	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM detection_alert_labels WHERE tenant_id=$1`, tenant).Scan(&count)
	if count != 0 {
		t.Fatal("case determination auto-labelled alerts")
	}
	zero := 0
	in := CaseAlertLabelInput{Confirm: true, ExpectedVersion: &zero, Label: "false_positive", Rationale: "Reviewed supplied scanner evidence; local false positive."}
	if _, e = s.CaseFeedback(ctx, "foreign", c.ID, 25, 0); e == nil {
		t.Fatal("foreign case read")
	}
	for _, target := range []struct{ tenant, caseID, alertID string }{{"foreign", c.ID, "fp"}, {tenant, other.ID, "fp"}, {tenant, c.ID, "other"}, {tenant, c.ID, "invented"}} {
		if _, e = s.LabelCaseAlert(ctx, target.tenant, "analyst", target.caseID, target.alertID, in); e == nil {
			t.Fatal("foreign/forged link", target)
		}
	}
	_, e = pool.Exec(ctx, `CREATE FUNCTION feedback_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='source_alert_labelled' THEN RAISE EXCEPTION 'case audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER feedback_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION feedback_audit_fail()`)
	if e != nil {
		t.Fatal(e)
	}
	_, failed := s.LabelCaseAlert(ctx, tenant, "analyst", c.ID, "fp", in)
	if _, e = pool.Exec(ctx, `DROP TRIGGER feedback_audit_fail ON audit_events; DROP FUNCTION feedback_audit_fail()`); e != nil {
		t.Fatal(e)
	}
	if failed == nil {
		t.Fatal("ignored audit failure")
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM detection_alert_labels WHERE tenant_id=$1`, tenant).Scan(&count)
	if count != 0 {
		t.Fatal("partial label")
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='alert_labelled'`, tenant).Scan(&count)
	if count != 0 {
		t.Fatal("partial rule audit")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.LabelCaseAlert(ctx, tenant, "analyst", c.ID, "fp", in); errs <- e }()
	}
	wg.Wait()
	close(errs)
	success := 0
	for e := range errs {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent approval", success)
	}
	in.Label = "true_positive"
	in.Rationale = "Explicitly reviewed the EDR alert independently of the case determination."
	if _, e = s.LabelCaseAlert(ctx, tenant, "analyst", c.ID, "tp", in); e != nil {
		t.Fatal(e)
	}
	// This other case's unreviewed scanner alert protects that source from exclusion.
	recs, e := s.Recommendations(ctx, tenant, rid, 30)
	if e != nil {
		t.Fatal(e)
	}
	if recs["statistics"].(map[string]any)["reviewed"] != 2 {
		t.Fatal(recs)
	}
	n, e := s.GenerateRecommendations(ctx, tenant, "analyst", rid, 30, 1)
	if e != nil || n != 1 {
		t.Fatal("expected only safe entity exclusion", n, e)
	}
	recs, e = s.Recommendations(ctx, tenant, rid, 30)
	if e != nil {
		t.Fatal(e)
	}
	rec := recs["items"].([]map[string]any)[0]["id"].(string)
	if _, e = s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "apply"); e == nil {
		t.Fatal("applied without replay")
	}
	if _, e = s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "validate"); e != nil {
		t.Fatal(e)
	}
	tested, e := s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "test")
	if e != nil || !tested["test_result"].(ReplayResult).Passed {
		t.Fatal(tested, e)
	}
	one := 1
	in = CaseAlertLabelInput{Confirm: true, ExpectedVersion: &one, Label: "false_positive", Rationale: "Updated reviewed evidence rationale."}
	if _, e = s.LabelCaseAlert(ctx, tenant, "analyst", c.ID, "fp", in); e != nil {
		t.Fatal(e)
	}
	if _, e = s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "apply"); e == nil {
		t.Fatal("case label did not invalidate frozen receipt")
	}
	if _, e = s.GenerateRecommendations(ctx, tenant, "analyst", rid, 30, 1); e != nil {
		t.Fatal(e)
	}
	recs, e = s.Recommendations(ctx, tenant, rid, 30)
	if e != nil {
		t.Fatal(e)
	}
	rec = recs["items"].([]map[string]any)[0]["id"].(string)
	if _, e = s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "test"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "apply"); e != nil {
		t.Fatal(e)
	}
	again, e := s.RecommendationAction(ctx, tenant, "analyst", rid, rec, "apply")
	if e != nil || again["idempotent"] != true {
		t.Fatal(again, e)
	}
	var version int
	var enabled bool
	pool.QueryRow(ctx, `SELECT version,(document->>'enabled')::boolean FROM detection_rules WHERE tenant_id=$1 AND id=$2`, tenant, rid).Scan(&version, &enabled)
	if version != 2 || enabled {
		t.Fatal("local apply enabled or duplicated rule", version, enabled)
	}
	unchanged, e := cases.Get(ctx, tenant, c.ID)
	if e != nil || unchanged.Determination != "benign" {
		t.Fatal("alert labels changed case", e)
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 AND action='source_alert_labelled'`, tenant, c.ID).Scan(&count)
	if count != 3 {
		t.Fatal("case audit count", count)
	}
}
