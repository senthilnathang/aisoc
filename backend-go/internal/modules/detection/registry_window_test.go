package detection

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestRegistryWindowMetricsIsolationAndPagination(t *testing.T) {
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
	tenant := "rule-window-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"alerts", "api_sources", "detection_rules", "investigations", "audit_events", "tenants"} {
			column := "tenant_id"
			if table == "tenants" {
				column = "id"
			}
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE `+column+`=$1`, tenant)
		}
	}()
	first, err := s.Create(ctx, tenant, map[string]any{"name": "Alpha", "severity": "high", "mitre_techniques": []any{"T1059.001"}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, tenant, map[string]any{"name": "Beta", "severity": "low", "enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	id := first["id"].(string)
	if _, err = pool.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,source,severity,determination,created_at,updated_at) VALUES($1,'case','Case','Direct','high','benign',now(),now())`, tenant); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct{ id, age string }{{"fresh-a", "1 hour"}, {"fresh-b", "2 hours"}, {"old", "45 days"}, {"future", "-1 day"}} {
		if _, err = pool.Exec(ctx, `INSERT INTO alerts(tenant_id,id,source,external_id,rule_id,investigation_id,document,payload_hash,created_at) VALUES($1,$2,'Sensor',$2,$3,'case','{"title":"Alert","severity":"high","routing":"Investigate"}',decode(repeat('00',32),'hex'),now()-$4::interval)`, tenant, entry.id, id, entry.age); err != nil {
			t.Fatal(err)
		}
	}
	read := func(o RegistryOptions, ruleID string) map[string]any {
		t.Helper()
		r, e := s.RegistryWindow(ctx, tenant, o, ruleID)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	opts := RegistryOptions{Days: 30, Limit: 1, Sort: "name", Direction: "asc"}
	result := read(opts, "")
	items := result["items"].([]any)
	row := items[0].(map[string]any)
	summary := result["summary"].(map[string]any)
	if row["id"] != id || row["detections"] != float64(2) || row["investigations"] != float64(1) || row["false_positive_rate"] != nil {
		t.Fatal("incorrect window or inferred FPR", row)
	}
	if row["outcomes"].([]any)[0].(map[string]any)["count"] != float64(1) {
		t.Fatal("duplicate case counted")
	}
	if summary["registry_rules"] != float64(2) || summary["triggered_alerts"] != float64(2) || summary["mapped_rules"] != float64(1) || summary["mitre_coverage"] != nil {
		t.Fatal("summary not full filtered set", summary)
	}
	opts.Offset = 1
	page := read(opts, "")
	if page["items"].([]any)[0].(map[string]any)["id"] != second["id"] || page["summary"].(map[string]any)["triggered_alerts"] != float64(2) {
		t.Fatal("pagination changed summary")
	}
	opts.Offset = 0
	opts.Days = 90
	if read(opts, id)["items"].([]any)[0].(map[string]any)["detections"] != float64(3) {
		t.Fatal("90-day range or future exclusion")
	}
	opts.Search = "' OR 1=1 --"
	if read(opts, "")["total"] != float64(0) {
		t.Fatal("search injection")
	}
	opts.Search = "ALPHA"
	if read(opts, "")["total"] != float64(1) {
		t.Fatal("literal search")
	}
	opts.Search = ""
	opts.Source = "Missing"
	if read(opts, "")["total"] != float64(0) {
		t.Fatal("source filter")
	}
	opts.Source = "Sensor"
	if read(opts, "")["total"] != float64(1) {
		t.Fatal("source match")
	}
	opts.Source = ""
	foreign, e := s.RegistryWindow(ctx, tenant+"-foreign", opts, "")
	if e != nil || foreign["total"] != float64(0) {
		t.Fatal("foreign tenant results", e)
	}
	if _, e = s.RegistryWindow(ctx, tenant+"-foreign", opts, id); e == nil {
		t.Fatal("foreign rule metrics visible")
	}
	legacy, e := s.Registry(ctx, tenant, RegistryOptions{Limit: 25})
	if e != nil || legacy["total"].(int) != 2 {
		t.Fatal("legacy endpoint changed", e)
	}
	if _, e = s.Update(ctx, tenant, id, map[string]any{"enabled": false}, []string{"enabled"}, 1, false); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Update(ctx, tenant, id, map[string]any{"enabled": true}, []string{"enabled"}, 1, false); e == nil {
		t.Fatal("stale version accepted")
	}
	if e = s.Delete(ctx, tenant, id); e == nil {
		t.Fatal("deleted referenced rule")
	}
	clone, e := s.Clone(ctx, tenant, id)
	if e != nil || clone["enabled"] != false {
		t.Fatal("clone should be disabled", e)
	}
}

func TestCatalogIsMetadataOnly(t *testing.T) {
	result, err := Catalog("")
	if err != nil {
		t.Fatal(err)
	}
	records := result["items"].([]map[string]any)
	if len(records) != 10 {
		t.Fatal("catalog missing")
	}
	for _, r := range records {
		if r["kind"] != "metadata_only" || r["query"] != nil || r["enabled"] != nil {
			t.Fatal("unexpected deployable catalog entry", r)
		}
	}
	filtered, _ := Catalog("kerberoasting")
	if filtered["total"].(int) != 1 {
		t.Fatal("catalog search")
	}
}
