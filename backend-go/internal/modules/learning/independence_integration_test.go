package learning

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestIndependentGuidanceApproval(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	pool, e := database.Open(ctx, url, 4)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if e = database.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	tenant := "approval-" + jobs.ID()
	s := Store{Pool: pool}
	memory := insights.Store{Pool: pool}
	sk := skills.Store{Pool: pool}
	defer func() {
		for _, table := range []string{"enterprise_insights", "skills", "audit_events"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, "DELETE FROM tenants WHERE id=$1", tenant)
	}()
	m, e := memory.Save(ctx, tenant, "author", "", insights.Input{ID: "EI-" + jobs.ID(), Artifact: "identity.test", Kind: "user", Content: "Local independently reviewed context"}, false)
	if e != nil {
		t.Fatal(e)
	}
	mid := m["id"].(string)
	in := LifecycleInput{Operation: "approve", ExpectedVersion: 1, Confirm: true, Rationale: "Review the saved guidance and scope."}
	for _, actor := range []string{"author", ""} {
		if _, e = s.ReviewLifecycle(ctx, tenant, actor, "enterprise-insights", mid, in); e == nil {
			t.Fatal("self approval", actor)
		}
	}
	state, e := s.Lifecycle(ctx, tenant, "enterprise-insights", mid)
	if e != nil || state["current"] != false || state["version"] != float64(1) {
		t.Fatal("denial mutated proposal", state, e)
	}
	if _, e = s.ReviewLifecycle(ctx, tenant+"-other", "reviewer", "enterprise-insights", mid, in); e == nil {
		t.Fatal("foreign approval")
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "reviewer", "enterprise-insights", mid, in); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "reviewer2", "enterprise-insights", mid, in); e == nil {
		t.Fatal("stale approval")
	}
	if _, e = memory.Save(ctx, tenant, "reviewer", mid, insights.Input{ExpectedVersion: 2, Artifact: "identity.test", Kind: "user", Content: "Changed context requires a new approval"}, false); e != nil {
		t.Fatal(e)
	}
	in.ExpectedVersion = 3
	if _, e = s.ReviewLifecycle(ctx, tenant, "reviewer", "enterprise-insights", mid, in); e == nil {
		t.Fatal("editor approved own change")
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "reviewer2", "enterprise-insights", mid, in); e != nil {
		t.Fatal(e)
	}
	draft, e := sk.Mutate(ctx, tenant, "", "create", "author", map[string]any{"name": "Independent skill"})
	if e != nil {
		t.Fatal(e)
	}
	sid := draft["id"].(string)
	if _, e = sk.Mutate(ctx, tenant, sid, "publish", "author", nil); e == nil {
		t.Fatal("self publication")
	}
	if _, e = sk.Mutate(ctx, tenant, sid, "save-publish", "reviewer", nil); e == nil {
		t.Fatal("combined editing/publication")
	}
	if _, e = sk.Mutate(ctx, tenant, sid, "publish", "reviewer", nil); e != nil {
		t.Fatal(e)
	}
	for _, actor := range []string{"editor1", "editor2"} {
		if _, e = sk.Mutate(ctx, tenant, sid, "patch", actor, map[string]any{"description": "Staged change"}); e != nil {
			t.Fatal(e)
		}
	}
	in = LifecycleInput{Operation: "publish-staged", ExpectedVersion: 4, Confirm: true, Rationale: "Review all saved staged changes."}
	for _, actor := range []string{"author", "editor1", "editor2"} {
		if _, e = s.ReviewLifecycle(ctx, tenant, actor, "skills", sid, in); e == nil {
			t.Fatal("contributor approved own staged revision", actor)
		}
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "reviewer", "skills", sid, in); e != nil {
		t.Fatal(e)
	}
}
