package intake

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestProcessingFailureRetryAndTenantIndicators(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "processor-" + jobs.ID()
	foreign := tenant + "-foreign"
	defer func() {
		for _, table := range []string{"investigation_steps", "case_records", "investigation_jobs", "alerts", "api_sources", "detection_rules", "investigations", "audit_events", "threat_indicators", "threat_intel_reports"} {
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE tenant_id=ANY($1)`, []string{tenant, foreign})
		}
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=ANY($1)`, []string{tenant, foreign})
	}()
	s := Store{Pool: pool}
	rules := detection.Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	r, err := rules.Create(ctx, tenant, map[string]any{"name": "Worker", "severity": "low"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := s.Create(ctx, tenant, "Sensor", "Test", r["id"].(string), 1, "tester")
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.IngestSource(ctx, tenant, source["source"].(map[string]any)["id"].(string), source["api_key"].(string), AlertInput{ExternalID: "first", Title: "Review", Severity: "low", Evidence: []Evidence{{Type: "ip", Value: "192.0.2.1"}, {Type: "domain", Value: "exact.example"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	caseID := accepted["alert"].(map[string]any)["investigation_id"].(string)
	queueState := func(status string, phase, active int) string {
		q, err := cases.Queue(ctx, tenant)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(q)
		var response struct {
			Items []struct {
				JobID  string `json:"job_id"`
				Status string `json:"run_status"`
				Phase  int    `json:"run_phase"`
			}
			Summary struct {
				Alerts int `json:"alerts"`
				Active int `json:"active_runs"`
				Open   int `json:"open_cases"`
			}
		}
		if err = json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Items) != 1 || response.Items[0].Status != status || response.Items[0].Phase != phase || response.Summary.Active != active || response.Summary.Alerts != 1 || response.Summary.Open != 1 {
			t.Fatal("queue transition mismatch", status, phase, active)
		}
		return response.Items[0].JobID
	}
	firstJob := queueState("queued", 0, 1)
	for _, owner := range []string{tenant, foreign} {
		if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, owner); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, `INSERT INTO threat_intel_reports(tenant_id,id,title,severity,published_at,created_at,updated_at) VALUES($1,'report','Fixture','low',now(),now(),now())`, owner); err != nil {
			t.Fatal(err)
		}
	}
	for _, v := range []struct{ tenant, id, kind, value, status string }{{tenant, "match", "ip", "192.0.2.1", "active"}, {tenant, "expired", "domain", "exact.example", "expired"}, {tenant, "case-sensitive", "domain", "EXACT.example", "active"}, {foreign, "foreign", "domain", "exact.example", "active"}} {
		if _, err = pool.Exec(ctx, `INSERT INTO threat_indicators(tenant_id,id,report_id,indicator_type,value,status,created_at,updated_at) VALUES($1,$2,'report',$3,$4,$5,now(),now())`, v.tenant, v.id, v.kind, v.value, v.status); err != nil {
			t.Fatal(err)
		}
	}
	process := func() {
		if worked, err := s.ProcessNext(ctx); err != nil || !worked {
			t.Fatal("phase did not commit", worked, err)
		}
	}
	process()
	queueState("running", 1, 1)
	name := pgx.Identifier{"fail_phase_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='investigation_progress' THEN RAISE EXCEPTION 'test progress audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	process()
	queueState("failed", 1, 0)
	detail, err := cases.Detail(ctx, tenant, caseID)
	if err != nil {
		t.Fatal(err)
	}
	run := detail.Jobs[0]
	if run["status"] != "failed" || run["phase"] != float64(1) || len(detail.Steps) != 1 {
		t.Fatal("failed phase was not rolled back")
	}
	if len(run["result"].(map[string]any)) != 0 {
		t.Fatal("failed result escaped")
	}
	if len(detail.Artifacts) != 2 {
		t.Fatal("completed phase lost")
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err = cases.Reinvestigate(ctx, tenant, caseID); err != nil {
		t.Fatal(err)
	}
	// Same timestamps must select the newly inserted retry by its ordinal.
	if _, err = pool.Exec(ctx, `UPDATE investigation_jobs SET created_at='2000-01-01T00:00:00Z' WHERE tenant_id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	if queueState("queued", 0, 1) == firstJob {
		t.Fatal("queue selected old failed run instead of retry")
	}
	// Competing worker instances must serialize each phase, not duplicate effects.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 4; j++ {
				_, err := s.ProcessNext(ctx)
				if err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	detail, err = cases.Detail(ctx, tenant, caseID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Determination != "suspicious" || len(detail.Artifacts) != 2 || len(detail.Steps) != 4 {
		t.Fatal("retry lost or duplicated work")
	}
	run = detail.Jobs[0]
	if run["status"] != "completed" || run["phase"] != float64(3) {
		t.Fatal("retry incomplete")
	}
	matches := run["result"].(map[string]any)["matches"].([]any)
	if len(matches) != 1 || matches[0].(map[string]any)["id"] != "match" {
		t.Fatal("indicator isolation/filter mismatch")
	}
	queueState("completed", 3, 0)
}
