package routing_test

import (
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/modules/routing"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestRoutingPreviewActivationIntakeAndIsolation(t *testing.T) {
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
	tenant := "routing-" + jobs.ID()
	s := routing.Store{Pool: pool}
	in := intake.Store{Pool: pool}
	defer func() {
		for _, table := range []string{"detection_routing_previews", "detection_routing_configs", "skill_applications", "investigation_steps", "case_records", "investigation_jobs", "alerts", "detection_rules", "investigations", "audit_events"} {
			if _, err := pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant); err != nil {
				t.Error(err)
			}
		}
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO tenants(id) VALUES($1)`, tenant)
	exec(`INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'r','{"enabled":true,"routing":"Investigate"}',now()),($1,'protected','{"enabled":true,"routing":"Escalate"}',now())`, tenant)
	config := routing.Config{Policies: []routing.Policy{{ID: "scanner", Name: "Scanner exclusion", Status: "draft", Outcome: "Suppress", Source: "scanner", ExceptList: "trusted"}}, Lists: []routing.EntityList{{ID: "trusted", Name: "Protected entities", Values: []string{"vip"}}}}
	state, e := s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config})
	if e != nil || state.Version != 1 {
		t.Fatal(state, e)
	}
	config.Policies[0].Status = "enabled"
	if _, e = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 1}); e == nil {
		t.Fatal("enabled without receipt")
	}
	p, e := s.Simulate(ctx, tenant, "reviewer", routing.PreviewInput{Config: config, ExpectedVersion: 1})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 1, PreviewID: p["preview_id"].(string)}); e == nil {
		t.Fatal("empty sample activated")
	}
	ingest := func(id, rule, entity string) map[string]any {
		t.Helper()
		v, err := in.IngestOperator(ctx, tenant, intake.AlertInput{ExternalID: id, Source: "scanner", RuleID: rule, Title: "Routing test", Severity: "low", PrimaryEntity: entity})
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	ingest("before", "r", "scanner-host")
	preview := func() string {
		t.Helper()
		v, err := s.Simulate(ctx, tenant, "reviewer", routing.PreviewInput{Config: config, ExpectedVersion: 1})
		if err != nil {
			t.Fatal(err)
		}
		if v["sample_size"] != 1 {
			t.Fatal(v)
		}
		return v["preview_id"].(string)
	}
	pid := preview()
	if _, err := s.Save(ctx, tenant+"-foreign", "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 0, PreviewID: pid}); err == nil {
		t.Fatal("foreign receipt accepted")
	}
	changed := config
	changed.Policies = append([]routing.Policy{}, config.Policies...)
	changed.Policies[0].Outcome = "Investigate"
	if _, err := s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: changed, ExpectedVersion: 1, PreviewID: pid}); err == nil {
		t.Fatal("receipt accepted different configuration")
	}
	foreign, e := s.Get(ctx, tenant+"-other")
	if e != nil || foreign.Version != 0 || len(foreign.Config.Policies) != 0 {
		t.Fatal("tenant leak", foreign, e)
	}
	exec(`UPDATE detection_routing_previews SET created_at=now()-interval '16 minutes' WHERE tenant_id=$1 AND id=$2`, tenant, pid)
	if _, e = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 1, PreviewID: pid}); e == nil {
		t.Fatal("expired receipt")
	}
	pid = preview()
	exec(`UPDATE alerts SET document=jsonb_set(document,'{severity}','"high"') WHERE tenant_id=$1`, tenant)
	if _, e = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 1, PreviewID: pid}); e == nil {
		t.Fatal("changed evidence")
	}
	pid = preview()
	name := pgx.Identifier{"fail_route_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	exec(`CREATE FUNCTION ` + name + `() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='` + tenant + `' AND NEW.action='routing_saved' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$`)
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	exec(`CREATE TRIGGER ` + name + ` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ` + name + `() `)
	if _, e = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 1, PreviewID: pid}); e == nil {
		t.Fatal("audit failure committed")
	}
	state, _ = s.Get(ctx, tenant)
	if state.Version != 1 {
		t.Fatal("partial config write")
	}
	exec(`DROP TRIGGER ` + name + ` ON audit_events`)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 1, PreviewID: pid})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	ok := 0
	for err := range results {
		if err == nil {
			ok++
		}
	}
	if ok != 1 {
		t.Fatal("CAS winners", ok)
	}
	v := ingest("after", "r", "scanner-host")
	alert := v["alert"].(map[string]any)
	if alert["disposition"] != "suppressed" || alert["investigation_id"] != nil {
		t.Fatal("policy not applied", alert)
	}
	raw, _ := json.Marshal(alert["routing_decision"])
	if !strings.Contains(string(raw), `"policy_id":"scanner"`) {
		t.Fatal("missing provenance", string(raw))
	}
	if ingest("vip", "r", "vip")["alert"].(map[string]any)["disposition"] != "investigate" {
		t.Fatal("exception failed")
	}
	if ingest("critical", "protected", "scanner-host")["alert"].(map[string]any)["routing"] != "Escalate" {
		t.Fatal("escalation downgraded")
	}
	config.Policies[0].Status = "archived"
	if _, e = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 2}); e != nil {
		t.Fatal("cannot disable", e)
	}
	if ingest("after", "r", "scanner-host")["duplicate"] != true {
		t.Fatal("replay changed original decision")
	}
	if ingest("new", "r", "scanner-host")["alert"].(map[string]any)["disposition"] != "investigate" {
		t.Fatal("fallback not restored")
	}
	config.Policies[0].Status = "enabled"
	config.Policies[0].Outcome = "Sample (10%)"
	samplePreview, err := s.Simulate(ctx, tenant, "reviewer", routing.PreviewInput{Config: config, ExpectedVersion: 3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Save(ctx, tenant, "reviewer", routing.SaveInput{Config: config, ExpectedVersion: 3, PreviewID: samplePreview["preview_id"].(string)}); err != nil {
		t.Fatal(err)
	}
	selected, skipped := false, false
	for i := 0; i < 100 && (!selected || !skipped); i++ {
		id := fmt.Sprintf("sample-%d", i)
		key, _ := json.Marshal([]string{tenant, "scanner", id})
		hash := sha256.Sum256(key)
		wantSample := binary.BigEndian.Uint32(hash[:4])%10 == 0
		if wantSample && selected || !wantSample && skipped {
			continue
		}
		a := ingest(id, "r", "scanner-host")["alert"].(map[string]any)
		expected := "not_sampled"
		if wantSample {
			expected = "investigate"
			selected = true
		} else {
			skipped = true
		}
		if a["routing"] != "Sample (10%)" || a["disposition"] != expected {
			t.Fatal("sampling changed", a)
		}
		if !wantSample && a["investigation_id"] != nil {
			t.Fatal("unsampled investigation created")
		}
	}
	if !selected || !skipped {
		t.Fatal("sampling test did not exercise both decisions")
	}
	audit, e := s.Audit(ctx, tenant)
	if e != nil || !strings.Contains(string(audit), "routing_saved") {
		t.Fatal("missing audit", e)
	}
}
