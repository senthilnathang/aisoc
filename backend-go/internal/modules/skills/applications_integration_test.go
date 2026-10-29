package skills

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestApplicationSnapshotsFeedbackAndIsolation(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
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
	tenant := "applications-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM skills WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	r, err := s.Mutate(ctx, tenant, "", "create", "actor", map[string]any{"name": "Match", "modules": []string{"investigations"}, "runtime_entities": []string{"ip"}})
	if err != nil {
		t.Fatal(err)
	}
	id := r["id"].(string)
	m, err := s.MutateMaterial(ctx, tenant, id, "", "create", "actor", map[string]any{"name": "guide.txt", "content": "Original"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Mutate(ctx, tenant, id, "publish", "actor", nil); err != nil {
		t.Fatal(err)
	}
	caseID := "case-" + jobs.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,source,severity,status,determination,created_at,updated_at) VALUES($1,$2,'Case','Sensor','low','closed','benign',now(),now())`, tenant, caseID); err != nil {
		t.Fatal(err)
	}
	apply := func(tenant string, runtime []string) []map[string]any {
		tx, e := pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		v, e := Apply(ctx, tx, tenant, "investigation", caseID, Context{Module: "investigations", Source: "Sensor", RuntimeEntities: runtime})
		if e != nil {
			t.Fatal(e)
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
		return v
	}
	if len(apply(tenant, nil)) != 0 {
		t.Fatal("runtime-only skill matched without evidence")
	}
	if len(apply(tenant+"-foreign", []string{"ip"})) != 0 {
		t.Fatal("foreign skill matched")
	}
	first := apply(tenant, []string{"ip"})
	if len(first) != 1 {
		t.Fatal("missing match")
	}
	again := apply(tenant, []string{"IP"})
	if len(again) != 1 || again[0]["already_applied"] != true {
		t.Fatal("duplicate application")
	}
	if _, err = s.MutateMaterial(ctx, tenant, id, m["id"].(string), "patch", "actor", map[string]any{"content": "Revised"}); err != nil {
		t.Fatal(err)
	}
	apps, err := Applications(ctx, pool, tenant, "investigation", caseID)
	if err != nil {
		t.Fatal(err)
	}
	snap := apps[0]["snapshot"].(map[string]any)
	if snap["materials"].([]any)[0].(map[string]any)["content"] != "Original" {
		t.Fatal("snapshot mutated")
	}
	if len(apply(tenant, []string{"ip"})) != 1 {
		t.Fatal("new revision not applied")
	}
	appID := first[0]["id"].(string)
	for _, rating := range []string{"helpful", "not_helpful"} {
		if _, err = s.Feedback(ctx, tenant, appID, "actor", rating, " note "); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Feedback(ctx, tenant+"-foreign", appID, "actor", "helpful", ""); err == nil {
		t.Fatal("foreign feedback")
	}
	outcome, err := s.Outcomes(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	item := outcome["items"].([]map[string]any)[0]
	if item["applications"] != int64(2) || item["case_applications"] != int64(1) || item["not_helpful"] != int64(1) || item["labeled_closed_cases"] != int64(1) {
		t.Fatal("outcome counts", item)
	}
	// Empty-tenant refresh must not depend on legacy table names or seed rows.
	suggestions, err := s.Suggestions(ctx, tenant+"-empty", "pending")
	if err != nil || len(suggestions["items"].([]map[string]any)) != 0 {
		t.Fatal("empty suggestions", err)
	}
}
