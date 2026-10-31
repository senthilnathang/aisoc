package detection

import (
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

func TestLocalRecommendationReplayGuards(t *testing.T) {
	for _, raw := range []string{`SELECT * FROM alerts`, `{"dialect":"aisoc-exclusion-v1","field":"source","value":"x","sql":"DROP"}`, `{"dialect":"aisoc-exclusion-v1","field":"tenant_id","value":"x"}`, `{"dialect":"aisoc-exclusion-v1","field":"source","value":""}`} {
		if _, err := parseExclusion(raw); err == nil {
			t.Fatal("unsupported query accepted")
		}
	}
	sample := []RecommendationSample{{ID: "fp", Source: "scanner", PrimaryEntity: "scan", Label: "false_positive"}, {ID: "tp", Source: "edr", PrimaryEntity: "host", Label: "true_positive"}, {ID: "unknown", Source: "iam", Label: "unreviewed"}}
	candidates := suggest(sample)
	if len(candidates) != 2 {
		t.Fatal("expected bounded safe candidates", candidates)
	}
	for _, q := range candidates {
		r := replay(q, sample)
		if !r.Passed || r.FalsePositivesRemoved != 1 || r.TruePositivesRemoved != 0 || r.UnreviewedRemoved != 0 {
			t.Fatal(r)
		}
	}
	q := LocalExclusion{recommendationDialect, "source", "scanner"}
	sample[2].Source = "scanner"
	if replay(q, sample).Passed {
		t.Fatal("unreviewed suppression allowed")
	}
	sample[1].Source = "scanner"
	if replay(q, sample).Passed {
		t.Fatal("TP suppression allowed")
	}
	if replay(q, []RecommendationSample{{Source: "scanner", Label: "false_positive"}}).Passed {
		t.Fatal("missing TP baseline accepted")
	}
}
func TestRecommendationWorkflowAtomicLocalApply(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "recommend-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"detection_rule_recommendations", "detection_alert_labels", "api_sources", "alerts", "detection_rules", "audit_events", "tenants"} {
			column := "tenant_id"
			if table == "tenants" {
				column = "id"
			}
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE `+column+`=$1`, tenant)
		}
	}()
	rule, err := s.Create(ctx, tenant, map[string]any{"name": "Local rule", "severity": "high", "enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	id := rule["id"].(string)
	for _, a := range []struct{ id, source, entity string }{{"fp", "scanner", "scan"}, {"tp", "edr", "host"}, {"unknown", "iam", "user"}} {
		doc, _ := json.Marshal(map[string]any{"title": a.id, "severity": "high", "payload": map[string]any{"primary_entity": a.entity}})
		if _, err = pool.Exec(ctx, `INSERT INTO alerts(tenant_id,id,source,external_id,rule_id,document,payload_hash,created_at) VALUES($1,$2,$3,$2,$4,$5,decode(repeat('00',32),'hex'),now())`, tenant, a.id, a.source, id, doc); err != nil {
			t.Fatal(err)
		}
	}
	list := func() map[string]any {
		t.Helper()
		r, e := s.Recommendations(ctx, tenant, id, 30)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	if list()["statistics"].(map[string]any)["false_positive_share"] != nil {
		t.Fatal("unlabelled FP share invented")
	}
	label := func(alert, value string, expected int) {
		t.Helper()
		if _, e := s.LabelAlert(ctx, tenant, "analyst", id, alert, AlertLabelInput{value, "Reviewed evidence", expected}); e != nil {
			t.Fatal(e)
		}
	}
	label("fp", "false_positive", 0)
	label("tp", "true_positive", 0)
	if _, err = s.LabelAlert(ctx, tenant, "analyst", id, "fp", AlertLabelInput{"true_positive", "stale", 0}); err == nil {
		t.Fatal("stale label accepted")
	}
	if _, err = s.LabelAlert(ctx, tenant+"-foreign", "analyst", id, "fp", AlertLabelInput{"false_positive", "foreign", 0}); err == nil {
		t.Fatal("foreign label accepted")
	}
	if list()["statistics"].(map[string]any)["false_positive_share"] != float64(50) {
		t.Fatal("FP denominator incorrect")
	}
	window, err := s.RegistryWindow(ctx, tenant, RegistryOptions{Days: 30, Limit: 10}, id)
	if err != nil || window["items"].([]any)[0].(map[string]any)["false_positive_rate"] != float64(50) {
		t.Fatal("registry metrics mismatch", err)
	}
	generate := func(version int) string {
		t.Helper()
		n, e := s.GenerateRecommendations(ctx, tenant, "analyst", id, 30, version)
		if e != nil || n != 2 {
			t.Fatal("generate", n, e)
		}
		return list()["items"].([]map[string]any)[0]["id"].(string)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO alerts(tenant_id,id,source,external_id,rule_id,document,payload_hash,created_at) SELECT $1,'bulk-'||n,'scanner','bulk-'||n,$2,'{}'::jsonb,decode(repeat('00',32),'hex'),now() FROM generate_series(1,501) n`, tenant, id); err != nil {
		t.Fatal(err)
	}
	if list()["sample_truncated"] != true {
		t.Fatal("sample cap not disclosed")
	}
	if _, err = s.GenerateRecommendations(ctx, tenant, "analyst", id, 30, 1); err == nil {
		t.Fatal("oversized replay allowed")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM alerts WHERE tenant_id=$1 AND id LIKE 'bulk-%'`, tenant); err != nil {
		t.Fatal(err)
	}
	rec := generate(1)
	if n, e := s.GenerateRecommendations(ctx, tenant, "analyst", id, 30, 1); e != nil || n != 0 {
		t.Fatal("duplicate generation", n, e)
	}
	action := func(rec, verb string) map[string]any {
		t.Helper()
		r, e := s.RecommendationAction(ctx, tenant, "analyst", id, rec, verb)
		if e != nil {
			t.Fatal(verb, e)
		}
		return r
	}
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("apply without replay")
	}
	action(rec, "validate")
	report := action(rec, "test")["test_result"].(ReplayResult)
	if !report.Passed {
		t.Fatal(report)
	}
	if _, err = s.RecommendationAction(ctx, tenant+"-foreign", "analyst", id, rec, "test"); err == nil {
		t.Fatal("foreign test accepted")
	}
	label("fp", "false_positive", 1)
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("changed label not invalidated")
	}
	rec = generate(1)
	action(rec, "test")
	if _, err = s.Update(ctx, tenant, id, map[string]any{"enabled": true}, []string{"enabled"}, 1, false); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("stale rule version applied")
	}
	rec = generate(2)
	action(rec, "test")
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("enabled rule applied")
	}
	if _, err = s.Update(ctx, tenant, id, map[string]any{"enabled": false}, []string{"enabled"}, 2, false); err != nil {
		t.Fatal(err)
	}
	rec = generate(3)
	action(rec, "test")
	if _, err = pool.Exec(ctx, `UPDATE detection_rule_recommendations SET tested_at=now()-interval '25 hours' WHERE tenant_id=$1 AND id=$2`, tenant, rec); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("expired test receipt applied")
	}
	action(rec, "test")
	if _, err = pool.Exec(ctx, `INSERT INTO api_sources(id,tenant_id,name,provider,rule_id,expires_at,created_at,updated_at) VALUES('bound',$1,'Provider','QRadar',$2,now(),now(),now())`, tenant, id); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("provider-bound local apply")
	}
	pool.Exec(ctx, `DELETE FROM api_sources WHERE tenant_id=$1`, tenant)
	name := pgx.Identifier{"fail_rec_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='recommendation_apply' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply"); err == nil {
		t.Fatal("apply survived audit failure")
	}
	detail, err := s.Detail(ctx, tenant, id)
	if err != nil || detail["version"] != 3 || detail["query"] != "" {
		t.Fatal("partial rule update", err, detail)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errors := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.RecommendationAction(ctx, tenant, "analyst", id, rec, "apply")
			errors <- e
		}()
	}
	wg.Wait()
	close(errors)
	for e := range errors {
		if e != nil {
			t.Fatal("concurrent apply", e)
		}
	}
	var auditCount int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='recommendation_apply'`, tenant).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatal("duplicate apply audit", auditCount, err)
	}
	action(rec, "apply")
	detail, err = s.Detail(ctx, tenant, id)
	if err != nil || detail["version"] != 4 || detail["enabled"] != false {
		t.Fatal("apply did not version/retain disabled", err)
	}
	if _, err = parseExclusion(detail["query"].(string)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GenerateRecommendations(ctx, tenant, "analyst", id, 30, 4); err == nil {
		t.Fatal("repeated tuning without new baseline")
	}
	for _, item := range list()["items"].([]map[string]any) {
		if item["status"] == "pending" {
			other := item["id"].(string)
			action(other, "dismiss")
			action(other, "dismiss")
			break
		}
	}
}
