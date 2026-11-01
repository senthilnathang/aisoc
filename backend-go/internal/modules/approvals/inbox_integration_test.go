package approvals

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/learning"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestInboxGuidanceLifecycleAndTenantIsolation(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
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
	tenant := "inbox-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"enterprise_insights", "skills", "audit_events"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, "DELETE FROM tenants WHERE id=$1", tenant)
	}()
	mem, err := (insights.Store{Pool: pool}).Save(ctx, tenant, "author", "", insights.Input{ID: "EI-" + jobs.ID(), Artifact: "local@example.test", Kind: "user", Content: "Local source context for independent review"}, false)
	if err != nil {
		t.Fatal(err)
	}
	skill, err := (skills.Store{Pool: pool}).Mutate(ctx, tenant, "", "create", "author", map[string]any{"name": "Inbox draft", "content_markdown": "Saved instructions"})
	if err != nil {
		t.Fatal(err)
	}
	check := func(scope, kind string, limit, offset int, total float64) map[string]any {
		t.Helper()
		v, e := s.Inbox(ctx, scope, kind, "all", "", limit, offset)
		if e != nil || v["total"] != total {
			t.Fatalf("%s: %v %v", kind, v, e)
		}
		return v
	}
	v := check(tenant, "all", 1, 0, 2)
	first := v["items"].([]any)[0].(map[string]any)
	v = check(tenant, "all", 1, 1, 2)
	if first["id"] == v["items"].([]any)[0].(map[string]any)["id"] {
		t.Fatal("unstable pagination")
	}
	check(tenant+"-foreign", "all", 25, 0, 0)
	check(tenant, "memory", 25, 0, 1)
	check(tenant, "skill", 25, 0, 1)
	if _, err = (learning.Store{Pool: pool}).ReviewLifecycle(ctx, tenant, "reviewer", "enterprise-insights", mem["id"].(string), learning.LifecycleInput{Operation: "approve", ExpectedVersion: 1, Confirm: true, Rationale: "Reviewed saved source and context"}); err != nil {
		t.Fatal(err)
	}
	check(tenant, "memory", 25, 0, 0)
	if _, err = (skills.Store{Pool: pool}).Mutate(ctx, tenant, skill["id"].(string), "publish", "reviewer", nil); err != nil {
		t.Fatal(err)
	}
	check(tenant, "all", 25, 0, 0)
	if _, err = (skills.Store{Pool: pool}).Mutate(ctx, tenant, skill["id"].(string), "patch", "editor", map[string]any{"description": "Changed saved draft"}); err != nil {
		t.Fatal(err)
	}
	v = check(tenant, "skill", 25, 0, 1)
	doc := v["items"].([]any)[0].(map[string]any)["document"].(map[string]any)
	if doc["staged_edit"] == nil || doc["version"] != float64(3) {
		t.Fatal("missing saved revision preview", doc)
	}
	if _, err = pool.Exec(ctx, "UPDATE enterprise_insights SET valid_until=now()-interval '1 minute' WHERE tenant_id=$1", tenant); err != nil {
		t.Fatal(err)
	}
	v = check(tenant, "memory", 25, 0, 1)
	if v["items"].([]any)[0].(map[string]any)["expires_at"] == nil {
		t.Fatal("expiry omitted")
	}
	if _, err = pool.Exec(ctx, "UPDATE enterprise_insights SET archived=true WHERE tenant_id=$1", tenant); err != nil {
		t.Fatal(err)
	}
	check(tenant, "memory", 25, 0, 0)
}
