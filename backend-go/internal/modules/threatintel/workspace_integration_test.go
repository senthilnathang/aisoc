package threatintel

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestThreatRegistryMetadataAndAtomicHuntLinks(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 5)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "threat-workspace-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		pool.Exec(ctx, `DELETE FROM threat_intel_reports WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	raw := func(m map[string]any) map[string]json.RawMessage {
		r := map[string]json.RawMessage{}
		for k, v := range m {
			r[k], _ = json.Marshal(v)
		}
		return r
	}
	report, err := s.Mutate(ctx, Reports, tenant, "", "create", raw(map[string]any{"title": "Identity advisory", "severity": "high", "source": "Analyst", "threat_actor": "Unknown actor", "targeted_industry": "Finance", "targeted_region": "EU", "relevant": true, "ioc_count": 999}), nil)
	if err != nil {
		t.Fatal(err)
	}
	id := report["id"].(string)
	ioc, err := s.Mutate(ctx, Indicators, tenant, "", "create", raw(map[string]any{"report_id": id, "indicator_type": "ip", "value": "192.0.2.42"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	indicator := ioc["id"].(string)
	registry, err := s.Registry(ctx, tenant, "Finance", "", true, 1, 0)
	if err != nil || registry.Total != 1 || registry.Sources != 1 || len(registry.Items) != 1 || registry.Items[0]["indicator_count_actual"] != float64(1) {
		t.Fatal(registry, err)
	}
	empty, err := s.Registry(ctx, tenant, "no-such-source", "", false, 50, 0)
	if err != nil || empty.Total != 0 || len(empty.Items) != 0 {
		t.Fatal(empty, err)
	}
	foreign, err := s.Registry(ctx, "foreign", "", "", false, 50, 0)
	if err != nil || foreign.Total != 0 {
		t.Fatal(foreign, err)
	}
	if _, err = s.Workspace(ctx, "foreign", id); err == nil {
		t.Fatal("cross tenant workspace")
	}
	edited, err := s.Mutate(ctx, Reports, tenant, id, "patch", raw(map[string]any{"threat_actor": "Updated actor", "expected_updated_at": report["updated_at"]}), []string{"threat_actor"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Mutate(ctx, Reports, tenant, id, "patch", raw(map[string]any{"threat_actor": "Stale actor", "expected_updated_at": report["updated_at"]}), nil); err == nil {
		t.Fatal("stale report edit")
	}
	var wg sync.WaitGroup
	links := make(chan HuntLink, 2)
	errs := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			l, e := s.CreateLocalHunt(ctx, tenant, id, "analyst", "request-1", indicator)
			links <- l
			errs <- e
		}()
	}
	wg.Wait()
	close(links)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	huntID := ""
	for l := range links {
		if huntID != "" && huntID != l.HuntID {
			t.Fatal("duplicate hunt")
		}
		huntID = l.HuntID
	}
	var document map[string]any
	if err = pool.QueryRow(ctx, `SELECT document FROM hunts WHERE tenant_id=$1 AND id=$2`, tenant, huntID).Scan(&document); err != nil || document["query"] != "192.0.2.42" || document["status"] != "draft" {
		t.Fatal(document, err)
	}
	w, err := s.Workspace(ctx, tenant, id)
	if err != nil || w["indicator_count"] != int64(1) || len(w["hunts"].([]HuntLink)) != 1 {
		t.Fatal(w, err)
	}
	if _, err = s.CreateLocalHunt(ctx, "foreign", id, "analyst", "request-x", indicator); err == nil {
		t.Fatal("cross tenant hunt")
	}
	if _, err = s.CreateLocalHunt(ctx, tenant, id, "another-actor", "request-1", indicator); err == nil {
		t.Fatal("request identity reuse")
	}
	other, err := s.Mutate(ctx, Reports, tenant, "", "create", raw(map[string]any{"title": "Other", "severity": "low"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateLocalHunt(ctx, tenant, other["id"].(string), "analyst", "other", indicator); err == nil {
		t.Fatal("cross report indicator")
	}
	// Fail the report audit after hunt creation, link insertion and hunt audit.
	constraint := "link_audit_" + id[4:]
	_, err = pool.Exec(ctx, `ALTER TABLE audit_events ADD CONSTRAINT `+constraint+` CHECK(resource_id <> '`+id+`' OR action <> 'local_hunt_created') NOT VALID`)
	if err != nil {
		t.Fatal(err)
	}
	_, failure := s.CreateLocalHunt(ctx, tenant, id, "analyst", "must-rollback", indicator)
	_, drop := pool.Exec(ctx, `ALTER TABLE audit_events DROP CONSTRAINT `+constraint)
	if failure == nil || drop != nil {
		t.Fatal(failure, drop)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM hunts WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 1 {
		t.Fatal("hunt escaped rollback", count, err)
	}
	_, err = s.Mutate(ctx, Reports, tenant, id, "patch", raw(map[string]any{"status": "archived", "expected_updated_at": edited["updated_at"]}), []string{"status"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateLocalHunt(ctx, tenant, id, "analyst", "new-archived", indicator); err == nil {
		t.Fatal("archived report created hunt")
	}
	if _, err = s.CreateLocalHunt(ctx, tenant, id, "analyst", "request-1", indicator); err != nil {
		t.Fatal("replay lost after archive", err)
	}
	_, err = pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1 AND id=$2`, tenant, huntID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateLocalHunt(ctx, tenant, id, "analyst", "request-1", indicator); err == nil {
		t.Fatal("deleted hunt recreated by retry")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM hunts WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 0 {
		t.Fatal("retry created hunt", count, err)
	}
	w, err = s.Workspace(ctx, tenant, id)
	if err != nil || len(w["hunts"].([]HuntLink)) != 1 || w["hunts"].([]HuntLink)[0].Available {
		t.Fatal("missing deletion tombstone", w, err)
	}

}
