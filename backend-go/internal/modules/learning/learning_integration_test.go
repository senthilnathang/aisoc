package learning

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"
)

func TestApprovedOutcomeApplicationAndReplay(t *testing.T) {
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
	tenant := "learning-" + jobs.ID()
	store := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	sk := skills.Store{Pool: pool}
	memory := insights.Store{Pool: pool}
	defer func() {
		for _, table := range []string{"case_learning", "skill_applications", "skills", "enterprise_insight_applications", "enterprise_insights", "investigations", "audit_events", "tenants"} {
			column := "tenant_id"
			if table == "tenants" {
				column = "id"
			}
			if _, e := pool.Exec(ctx, "DELETE FROM "+table+" WHERE "+column+"=$1", tenant); e != nil {
				t.Error(e)
			}
		}
	}()
	create := func(status, determination, entity string) investigations.Record {
		r, e := cases.Create(ctx, tenant, investigations.Input{Title: "Local reviewed login", Summary: "Synthetic fixture", Source: "local-json", Category: "identity", Severity: "medium", Status: status, Determination: determination, PrimaryEntity: entity})
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	source := create("resolved", "benign", "review-user")
	_, e = pool.Exec(ctx, `INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES($1,'evidence-a',$2,'artifacts','{"id":"evidence-a","type":"entity","label":"Verified mock identity","value":"review-user"}',now(),now())`, tenant, source.ID)
	if e != nil {
		t.Fatal(e)
	}
	in := Input{ExpectedUpdatedAt: source.UpdatedAt, EvidenceIDs: []string{"evidence-a"}, Confirm: true, Rationale: "Reviewed synthetic authentication evidence and exceptions.", CreateSkill: true, Name: "Review identity exceptions", Guidance: "Compare supplied identity evidence and current MFA state; escalate missing context.", CreateMemory: true, MemoryKind: "user", Context: "Synthetic approved context: review-user belongs to the local training environment.", ValidUntil: time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)}
	for _, variant := range []string{"foreign", "stale", "evidence", "expiry", "open"} {
		bad := in
		scope := tenant
		id := source.ID
		switch variant {
		case "foreign":
			scope = "other"
		case "stale":
			bad.ExpectedUpdatedAt = "2020-01-01T00:00:00Z"
		case "evidence":
			bad.EvidenceIDs = []string{"invented"}
		case "expiry":
			bad.ValidUntil = "2020-01-01T00:00:00Z"
		case "open":
			r := create("open", "unknown", "review-user")
			id = r.ID
			bad.ExpectedUpdatedAt = r.UpdatedAt
		}
		if _, e = store.Propose(ctx, scope, id, "analyst", bad); e == nil {
			t.Fatal("accepted", variant)
		}
	}
	// A failure at the final audit must roll back both owning stores and the receipt.
	_, e = pool.Exec(ctx, `CREATE FUNCTION learning_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='learning_proposed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER learning_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION learning_fail()`)
	if e != nil {
		t.Fatal(e)
	}
	_, failed := store.Propose(ctx, tenant, source.ID, "analyst", in)
	if _, e = pool.Exec(ctx, `DROP TRIGGER learning_fail ON audit_events; DROP FUNCTION learning_fail()`); e != nil {
		t.Fatal(e)
	}
	if failed == nil {
		t.Fatal("ignored audit failure")
	}
	for _, table := range []string{"skills", "enterprise_insights", "case_learning"} {
		var count int
		if e = pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE tenant_id=$1", tenant).Scan(&count); e != nil || count != 0 {
			t.Fatal("partial learning", table, count, e)
		}
	}
	var wg sync.WaitGroup
	results := make(chan map[string]any, 4)
	errs := make(chan error, 4)
	for n := 0; n < 4; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := store.Propose(ctx, tenant, source.ID, "analyst", in)
			results <- r
			errs <- e
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var receipt map[string]any
	for r := range results {
		if receipt != nil && receipt["skill_id"] != r["skill_id"] {
			t.Fatal("duplicate skill")
		}
		receipt = r
	}
	sid := receipt["skill_id"].(string)
	mid := receipt["insight_id"].(string)
	bad := in
	bad.Guidance = "Different guidance after uncertain delivery."
	if _, e = store.Propose(ctx, tenant, source.ID, "analyst", bad); e == nil {
		t.Fatal("conflicting replay")
	}
	draft, e := sk.Get(ctx, tenant, sid)
	if e != nil || draft["state"] != "draft" || draft["enabled"] != false || draft["learning_origin"] == nil {
		t.Fatal(draft, e)
	}
	before := create("open", "unknown", "review-user")
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM skill_applications WHERE tenant_id=$1 AND target_id=$2 AND skill_id=$3`, tenant, before.ID, sid).Scan(&n)
	if n != 0 {
		t.Fatal("draft applied")
	}
	if _, e = sk.Mutate(ctx, tenant, sid, "publish", "reviewer", map[string]any{"expected_version": float64(1)}); e != nil {
		t.Fatal(e)
	}
	if _, e = store.ReviewLifecycle(ctx, tenant, "reviewer", "enterprise-insights", mid, LifecycleInput{Operation: "approve", ExpectedVersion: 1, Confirm: true, Rationale: "Independent review of saved Memory."}); e != nil {
		t.Fatal(e)
	}
	after := create("open", "unknown", "review-user")
	different := create("open", "unknown", "different-user")
	var snapshot []byte
	if e = pool.QueryRow(ctx, `SELECT document FROM skill_applications WHERE tenant_id=$1 AND target_id=$2 AND skill_id=$3`, tenant, after.ID, sid).Scan(&snapshot); e != nil {
		t.Fatal(e)
	}
	var app map[string]any
	json.Unmarshal(snapshot, &app)
	var guidance map[string]any
	json.Unmarshal([]byte(app["snapshot_json"].(string)), &guidance)
	if guidance["learning_origin"] == nil || guidance["content_markdown"] != in.Guidance {
		t.Fatal(guidance)
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM skill_applications WHERE tenant_id=$1 AND target_id=$2 AND skill_id=$3`, tenant, different.ID, sid).Scan(&n)
	if n != 0 {
		t.Fatal("unscoped skill")
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM enterprise_insight_applications WHERE tenant_id=$1 AND investigation_id=$2 AND insight_id=$3`, tenant, after.ID, mid).Scan(&n)
	if n != 1 {
		t.Fatal("memory not applied")
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM enterprise_insight_applications WHERE tenant_id=$1 AND investigation_id=$2 AND insight_id=$3`, tenant, different.ID, mid).Scan(&n)
	if n != 0 {
		t.Fatal("unscoped memory")
	}
	got, e := cases.Get(ctx, tenant, after.ID)
	if e != nil || got.Determination != "unknown" {
		t.Fatal("guidance changed verdict", got, e)
	}
	if _, e = sk.Mutate(ctx, tenant, sid, "patch", "analyst", map[string]any{"expected_version": float64(2), "content_markdown": "Revised future guidance only."}); e != nil {
		t.Fatal(e)
	}
	if _, e = memory.Save(ctx, tenant, "analyst", mid, insights.Input{ExpectedVersion: 2}, true); e != nil {
		t.Fatal(e)
	}
	later := create("open", "unknown", "review-user")
	pool.QueryRow(ctx, `SELECT count(*) FROM enterprise_insight_applications WHERE tenant_id=$1 AND investigation_id=$2 AND insight_id=$3`, tenant, later.ID, mid).Scan(&n)
	if n != 0 {
		t.Fatal("archived context applied")
	}
	var retained []byte
	pool.QueryRow(ctx, `SELECT document FROM skill_applications WHERE tenant_id=$1 AND target_id=$2 AND skill_id=$3`, tenant, after.ID, sid).Scan(&retained)
	if string(snapshot) != string(retained) {
		t.Fatal("snapshot changed")
	}
	if _, e = sk.Mutate(ctx, tenant, sid, "delete", "analyst", nil); e != nil {
		t.Fatal(e)
	}
	replay, e := store.Propose(ctx, tenant, source.ID, "analyst", in)
	if e != nil || replay["skill_id"] != sid {
		t.Fatal("receipt lost after delete", e)
	}
	if _, e = sk.Get(ctx, tenant, sid); e == nil {
		t.Fatal("deleted skill resurrected")
	}
}
