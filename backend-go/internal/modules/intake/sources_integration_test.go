package intake

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestCredentialsRollbackAndRuleDeletion(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 6)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "source-" + jobs.ID()
	s := Store{Pool: pool}
	rules := detection.Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM detection_rules WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM api_sources WHERE tenant_id=$1`, tenant)
	newRule := func() string {
		r, err := rules.Create(ctx, tenant, map[string]any{"name": "Bound", "severity": "high"})
		if err != nil {
			t.Fatal(err)
		}
		return r["id"].(string)
	}
	rule := newRule()
	created, err := s.Create(ctx, tenant, "Source", "Provider", rule, 30, "tester")
	if err != nil {
		t.Fatal(err)
	}
	id := created["source"].(map[string]any)["id"].(string)
	key := created["api_key"].(string)
	check := func(key string, valid bool) {
		got, err := s.Authenticate(ctx, id, key)
		if err != nil || (got == tenant) != valid {
			t.Fatal("credential authentication mismatch", valid, err)
		}
	}
	check(key, true)
	check("wrong", false)
	var hash []byte
	if err = pool.QueryRow(ctx, `SELECT key_hash FROM api_sources WHERE id=$1`, id).Scan(&hash); err != nil || len(hash) != 32 || string(hash) == key {
		t.Fatal("credential storage", err)
	}
	name := pgx.Identifier{"fail_source_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Create(ctx, tenant, "Fail", "Provider", rule, 30, "tester"); err == nil {
		t.Fatal("creation survived failed audit")
	}
	mapping := Mapping{Fields: map[string]string{"external_id": "event.id", "title": "event.title", "severity": "event.level"}, Order: []string{"title", "external_id", "severity"}}
	if _, err = s.SaveMapping(ctx, tenant, id, mapping, nil, "tester"); err == nil {
		t.Fatal("mapping survived failed audit")
	}
	unchanged, err := s.Get(ctx, tenant, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(unchanged["mapping"].(map[string]any)["fields"].(map[string]any)) != 0 {
		t.Fatal("partial mapping escaped")
	}
	for _, revoke := range []bool{false, true} {
		if _, err = s.Mutate(ctx, tenant, id, 1, "tester", revoke); err == nil {
			t.Fatal("mutation survived failed audit")
		}
		check(key, true)
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM api_sources WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 1 {
		t.Fatal("partial creation", n, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	rotated, err := s.Mutate(ctx, tenant, id, 1, "tester", false)
	if err != nil {
		t.Fatal(err)
	}
	check(key, false)
	key = rotated["api_key"].(string)
	check(key, true)
	if _, err = pool.Exec(ctx, `UPDATE api_sources SET expires_at=now()-interval '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	check(key, false)
	view, err := s.Get(ctx, tenant, id)
	if err != nil || view["status"] != "expired" {
		t.Fatal("expiry view", err)
	}
	rotated, err = s.Mutate(ctx, tenant, id, 1, "tester", false)
	if err != nil {
		t.Fatal(err)
	}
	key = rotated["api_key"].(string)
	check(key, true)
	for i := 0; i < 2; i++ {
		if _, err = s.Mutate(ctx, tenant, id, 0, "tester", true); err != nil {
			t.Fatal(err)
		}
	}
	check(key, false)
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 AND action='source_key_revoked'`, tenant, id).Scan(&n); err != nil || n != 1 {
		t.Fatal("revoke audit not idempotent", n, err)
	}
	var actor string
	if err = pool.QueryRow(ctx, `SELECT details->>'actor_id' FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 LIMIT 1`, tenant, id).Scan(&actor); err != nil || actor != "tester" {
		t.Fatal("actor attribution", err)
	}
	if err = rules.Delete(ctx, tenant, rule); err == nil {
		t.Fatal("deleted bound rule")
	}
	if _, err = s.Create(ctx, tenant+"-other", "Foreign", "Provider", rule, 1, "tester"); err == nil {
		t.Fatal("cross-tenant binding accepted")
	}
	// Either creation wins and deletion conflicts, or deletion wins and creation
	// sees a missing rule. A committed orphan or two successful writes is invalid.
	racingRule := newRule()
	var createErr, deleteErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, createErr = s.Create(ctx, tenant, "Race", "Provider", racingRule, 1, "tester")
	}()
	go func() { defer wg.Done(); deleteErr = rules.Delete(ctx, tenant, racingRule) }()
	wg.Wait()
	if (createErr == nil) == (deleteErr == nil) {
		t.Fatal("unexpected binding/delete race outcome", createErr, deleteErr)
	}
	var mappingErr, rotateErr error
	var rotation map[string]any
	wg.Add(2)
	go func() { defer wg.Done(); _, mappingErr = s.SaveMapping(ctx, tenant, id, mapping, nil, "tester") }()
	go func() { defer wg.Done(); rotation, rotateErr = s.Mutate(ctx, tenant, id, 1, "tester", false) }()
	wg.Wait()
	if mappingErr != nil || rotateErr != nil {
		t.Fatal(mappingErr, rotateErr)
	}
	check(rotation["api_key"].(string), true)
	var order []string
	var stored map[string]any
	if err = pool.QueryRow(ctx, `SELECT mapping_order,mapping FROM api_sources WHERE id=$1`, id).Scan(&order, &stored); err != nil {
		t.Fatal(err)
	}
	if strings.Join(order, ",") != "title,external_id,severity" || stored["fields"].(map[string]any)["title"] != "event.title" {
		t.Fatal("mapping/order lost during rotation")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 AND action='source_mapping_updated' AND details->>'actor_id'='tester'`, tenant, id).Scan(&n); err != nil || n != 1 {
		t.Fatal("mapping audit", err)
	}
}
