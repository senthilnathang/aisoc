package threatintel_test

import (
	"aisoc/backend/internal/modules/hunts"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/threatintel"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestJSONIntelHuntPromotionAtomicReplay(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	pool, e := database.Open(ctx, url, 8)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if e = database.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	tenant := "intel-flow-" + jobs.ID()
	defer func() {
		for _, table := range []string{"hunt_promotions", "threat_json_imports", "hunts", "threat_intel_reports", "investigations", "audit_events", "tenants"} {
			column := "tenant_id"
			if table == "tenants" {
				column = "id"
			}
			if _, e := pool.Exec(ctx, "DELETE FROM "+table+" WHERE "+column+"=$1", tenant); e != nil {
				t.Error(e)
			}
		}
	}()
	intel := threatintel.Store{Pool: pool}
	hunt := hunts.Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	source, e := cases.Create(ctx, tenant, investigations.Input{Title: "Mock endpoint observation", Source: "local-json", Summary: "Connection to example.test requires analyst review", Severity: "medium", Status: "open", Determination: "unknown"})
	if e != nil {
		t.Fatal(e)
	}
	in := threatintel.IntelImport{SchemaVersion: "1", Source: "Local test feed", ExternalID: "report-1", Title: "Example domain indicator", Summary: "Unverified local fixture", Severity: "medium", PublishedAt: "2026-11-01T00:00:00Z", Indicators: []threatintel.ImportIOC{{Type: "domain", Value: "Example.TEST."}, {Type: "domain", Value: "example.test", Severity: "high"}}}
	preview, e := threatintel.PreviewImport(in)
	if e != nil || preview.Unique != 1 || preview.Duplicates != 1 || preview.Document.Indicators[0].Severity != "high" {
		t.Fatal(preview, e)
	}

	_, e = pool.Exec(ctx, `CREATE FUNCTION intel_import_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='json_imported' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER intel_import_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION intel_import_fail()`)
	if e != nil {
		t.Fatal(e)
	}
	_, importFailure := intel.ImportJSON(ctx, tenant, "analyst", in)
	if _, e = pool.Exec(ctx, `DROP TRIGGER intel_import_fail ON audit_events; DROP FUNCTION intel_import_fail()`); e != nil {
		t.Fatal(e)
	}
	if importFailure == nil {
		t.Fatal("import audit failure ignored")
	}
	var reportCount int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM threat_intel_reports WHERE tenant_id=$1`, tenant).Scan(&reportCount); e != nil || reportCount != 0 {
		t.Fatal("partial import", reportCount, e)
	}
	var wg sync.WaitGroup
	ids := make(chan string, 4)
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := intel.ImportJSON(ctx, tenant, "analyst", in)
			errs <- e
			if e == nil {
				ids <- r["report_id"].(string)
			}
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	reportID := ""
	for id := range ids {
		if reportID != "" && reportID != id {
			t.Fatal("duplicate report")
		}
		reportID = id
	}
	changed := in
	changed.Title = "Changed content"
	if _, e = intel.ImportJSON(ctx, tenant, "analyst", changed); e == nil {
		t.Fatal("source conflict accepted")
	}
	indicators, e := intel.List(ctx, threatintel.Indicators, tenant, threatintel.Options{ReportID: reportID, Limit: 100})
	if e != nil || len(indicators) != 1 {
		t.Fatal(indicators, e)
	}
	link, e := intel.CreateLocalHunt(ctx, tenant, reportID, "analyst", "link-1", indicators[0]["id"].(string))
	if e != nil {
		t.Fatal(e)
	}
	workspace, e := hunt.Workspace(ctx, tenant, link.HuntID)
	if e != nil {
		t.Fatal(e)
	}
	run, e := hunt.Search(ctx, tenant, link.HuntID, "analyst", "run-1", workspace.Hunt["updated_at"].(string))
	if e != nil || len(run.Findings) != 1 || run.Findings[0].CaseID != source.ID {
		t.Fatal(run, e)
	}
	request := hunts.PromoteInput{RunID: run.ID, Kind: run.Findings[0].Kind, RecordID: run.Findings[0].RecordID, Comment: "Reviewed this local evidence match; investigation required.", Confirm: true}
	if _, e = hunt.Promote(ctx, "foreign", link.HuntID, "analyst", request); e == nil {
		t.Fatal("foreign promotion")
	}
	bad := request
	bad.Confirm = false
	if _, e = hunt.Promote(ctx, tenant, link.HuntID, "analyst", bad); e == nil {
		t.Fatal("unconfirmed")
	}
	bad = request
	bad.RecordID = "invented"
	if _, e = hunt.Promote(ctx, tenant, link.HuntID, "analyst", bad); e == nil {
		t.Fatal("invented finding")
	}
	_, e = pool.Exec(ctx, `CREATE FUNCTION intel_promotion_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hunt_finding_promoted' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER intel_promotion_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION intel_promotion_fail()`)
	if e != nil {
		t.Fatal(e)
	}
	_, fail := hunt.Promote(ctx, tenant, link.HuntID, "analyst", request)
	if _, e = pool.Exec(ctx, `DROP TRIGGER intel_promotion_fail ON audit_events; DROP FUNCTION intel_promotion_fail()`); e != nil {
		t.Fatal(e)
	}
	if fail == nil {
		t.Fatal("audit failure ignored")
	}
	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM investigations WHERE tenant_id=$1`, tenant).Scan(&count)
	if count != 1 {
		t.Fatal("partial case", count)
	}
	promoted := make(chan hunts.Promotion, 4)
	errs = make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, e := hunt.Promote(ctx, tenant, link.HuntID, "analyst", request)
			promoted <- p
			errs <- e
		}()
	}
	wg.Wait()
	close(promoted)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	caseID := ""
	for p := range promoted {
		if caseID != "" && caseID != p.InvestigationID {
			t.Fatal("duplicate promoted case")
		}
		caseID = p.InvestigationID
		if p.ReportID != reportID || p.Query != "example.test" {
			t.Fatal(p)
		}
	}
	record, e := cases.Get(ctx, tenant, caseID)
	if e != nil || record.Status != "open" || record.Determination != "unknown" {
		t.Fatal(record, e)
	}
	origin, e := hunt.CaseOrigin(ctx, tenant, caseID)
	if e != nil || len(origin) != 1 || !json.Valid(origin[0]) {
		t.Fatal(origin, e)
	}
	if _, e = hunt.CaseOrigin(ctx, "foreign", caseID); e == nil {
		t.Fatal("foreign provenance")
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM case_records WHERE tenant_id=$1 AND investigation_id=$2`, tenant, caseID).Scan(&count)
	if count != 1 {
		t.Fatal("missing artifact", count)
	}

	if _, e = pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, source.ID); e != nil {
		t.Fatal(e)
	}
	retained, e := hunt.CaseOrigin(ctx, tenant, caseID)
	if e != nil || len(retained) != 1 || string(retained[0]) != string(origin[0]) {
		t.Fatal("source deletion lost snapshot", e)
	}
	pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1 AND id=$2`, tenant, caseID)
	if _, e = hunt.Promote(ctx, tenant, link.HuntID, "analyst", request); e == nil {
		t.Fatal("deleted case resurrected")
	}
	if _, e = intel.Mutate(ctx, threatintel.Reports, tenant, reportID, "delete", nil, nil); e != nil {
		t.Fatal(e)
	}
	if _, e = intel.ImportJSON(ctx, tenant, "analyst", in); e == nil {
		t.Fatal("deleted report resurrected")
	}
}
