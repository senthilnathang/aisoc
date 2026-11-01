package learning

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestLifecycleStagingSourceChangeAndArchive(t *testing.T) {
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
	tenant := "lifecycle-" + jobs.ID()
	s := Store{Pool: pool}
	cases := investigations.Store{Pool: pool}
	sk := skills.Store{Pool: pool}
	create := func(status, verdict string) investigations.Record {
		r, e := cases.Create(ctx, tenant, investigations.Input{Title: "Lifecycle fixture", Source: "local-json", Severity: "medium", Status: status, Determination: verdict, PrimaryEntity: "lifecycle-user"})
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	sourceCase := create("resolved", "benign")
	artifact, e := cases.AddRecord(ctx, tenant, sourceCase.ID, "artifacts", map[string]any{"type": "entity", "value": "lifecycle-user", "label": "Reviewed fixture"})
	if e != nil {
		t.Fatal(e)
	}
	receipt, e := s.Approve(ctx, tenant, sourceCase.ID, "analyst", Input{ExpectedUpdatedAt: sourceCase.UpdatedAt, EvidenceIDs: []string{artifact["id"].(string)}, Confirm: true, Rationale: "Reviewed local fixture evidence.", CreateSkill: true, Name: "Lifecycle skill", Guidance: "Original reviewed guidance.", CreateMemory: true, MemoryKind: "user", Context: "Original local identity context.", ValidUntil: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)})
	if e != nil {
		t.Fatal(e)
	}
	sid, mid := receipt["skill_id"].(string), receipt["insight_id"].(string)
	if _, e = sk.Mutate(ctx, tenant, sid, "save-publish", "analyst", map[string]any{"expected_version": float64(1)}); e != nil {
		t.Fatal(e)
	}
	before := create("open", "unknown")
	staged, e := sk.Mutate(ctx, tenant, sid, "patch", "analyst", map[string]any{"expected_version": float64(2), "content_markdown": "Staged future guidance."})
	if e != nil || staged["content_markdown"] != "Original reviewed guidance." {
		t.Fatal(staged, e)
	}
	next := create("open", "unknown")
	var guidance string
	if e = pool.QueryRow(ctx, `SELECT document->>'snapshot_json' FROM skill_applications WHERE tenant_id=$1 AND target_id=$2 AND skill_id=$3`, tenant, next.ID, sid).Scan(&guidance); e != nil {
		t.Fatal(e)
	}
	var snap map[string]any
	json.Unmarshal([]byte(guidance), &snap)
	if snap["content_markdown"] != "Original reviewed guidance." || snap["version"] != float64(2) {
		t.Fatal(snap)
	}
	in := LifecycleInput{Operation: "publish-staged", ExpectedVersion: 3, Confirm: true, Rationale: "Reviewed and approve staged instructions."}
	bad := in
	bad.Confirm = false
	if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", "skills", sid, bad); e == nil {
		t.Fatal("no confirmation")
	}
	if _, e = s.ReviewLifecycle(ctx, "foreign", "analyst", "skills", sid, in); e == nil {
		t.Fatal("foreign publish")
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", "skills", sid, in); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", "skills", sid, in); e == nil {
		t.Fatal("stale publication")
	}
	// Source changes invalidate both owners without modifying earlier snapshots.
	changed, e := cases.Patch(ctx, tenant, sourceCase.ID, map[string]json.RawMessage{"determination": json.RawMessage(`"suspicious"`)}, []string{"determination"})
	if e != nil {
		t.Fatal(e)
	}
	for _, resource := range []struct{ kind, id string }{{"skills", sid}, {"enterprise-insights", mid}} {
		v, e := s.Lifecycle(ctx, tenant, resource.kind, resource.id)
		if e != nil || v["current"] != false {
			t.Fatal(v, e)
		}
	}
	blocked := create("open", "unknown")
	var count int
	pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM skill_applications WHERE tenant_id=$1 AND target_id=$2)+(SELECT count(*) FROM enterprise_insight_applications WHERE tenant_id=$1 AND investigation_id=$2)`, tenant, blocked.ID).Scan(&count)
	if count != 0 {
		t.Fatal("stale guidance applied")
	}
	for _, resource := range []struct {
		kind, id string
		version  int
	}{{"skills", sid, 4}, {"enterprise-insights", mid, 1}} {
		in := LifecycleInput{Operation: "reapprove", ExpectedVersion: resource.version, ExpectedSourceVersion: changed.UpdatedAt, Confirm: true, Rationale: "Reviewed changed outcome and continued applicability."}
		bad := in
		bad.ExpectedSourceVersion = sourceCase.UpdatedAt
		if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", resource.kind, resource.id, bad); e == nil {
			t.Fatal("stale source accepted")
		}
		if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", resource.kind, resource.id, in); e != nil {
			t.Fatal(e)
		}
	}
	resumed := create("open", "unknown")
	pool.QueryRow(ctx, `SELECT count(*) FROM skill_applications WHERE tenant_id=$1 AND target_id=$2`, tenant, resumed.ID).Scan(&count)
	if count != 1 {
		t.Fatal("reapproved skill not applied")
	}
	var old string
	pool.QueryRow(ctx, `SELECT document->>'snapshot_json' FROM skill_applications WHERE tenant_id=$1 AND target_id=$2 AND skill_id=$3`, tenant, next.ID, sid).Scan(&old)
	if old != guidance {
		t.Fatal("snapshot rewritten")
	}
	_ = before
	for _, resource := range []struct {
		kind, id string
		version  int
	}{{"skills", sid, 5}, {"enterprise-insights", mid, 2}} {
		if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", resource.kind, resource.id, LifecycleInput{Operation: "archive", ExpectedVersion: resource.version, Confirm: true, Rationale: "Explicitly retire local fixture guidance."}); e != nil {
			t.Fatal(e)
		}
	}
	archived := create("open", "unknown")
	pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM skill_applications WHERE tenant_id=$1 AND target_id=$2)+(SELECT count(*) FROM enterprise_insight_applications WHERE tenant_id=$1 AND investigation_id=$2)`, tenant, archived.ID).Scan(&count)
	if count != 0 {
		t.Fatal("archived guidance applied")
	}
	if _, e = sk.Mutate(ctx, tenant, sid, "set-enabled", "analyst", map[string]any{"expected_version": float64(6), "enabled": true}); e == nil {
		t.Fatal("archive bypass")
	}
}

func TestStagedMaterialsDiscardAndAuditRollback(t *testing.T) {
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
	tenant := "materials-release-" + jobs.ID()
	sk := skills.Store{Pool: pool}
	s := Store{Pool: pool}
	r, e := sk.Mutate(ctx, tenant, "", "create", "analyst", map[string]any{"name": "Material release"})
	if e != nil {
		t.Fatal(e)
	}
	id := r["id"].(string)
	material, e := sk.MutateMaterial(ctx, tenant, id, "", "create", "analyst", map[string]any{"name": "reference.txt", "content": "Original reference"})
	if e != nil {
		t.Fatal(e)
	}
	mid := material["id"].(string)
	if _, e = sk.Mutate(ctx, tenant, id, "publish", "analyst", nil); e != nil {
		t.Fatal(e)
	}
	if _, e = sk.MutateMaterial(ctx, tenant, id, mid, "patch", "analyst", map[string]any{"content": "Draft reference"}); e != nil {
		t.Fatal(e)
	}
	status, e := s.Lifecycle(ctx, tenant, "skills", id)
	if e != nil || status["materials_staged"] != true {
		t.Fatal(status, e)
	}
	in := LifecycleInput{Operation: "discard-staged", ExpectedVersion: 4, Confirm: true, Rationale: "Discard the unpublished reference change."}
	if _, e = pool.Exec(ctx, `CREATE FUNCTION lifecycle_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lifecycle_discard-staged' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER lifecycle_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION lifecycle_audit_fail()`); e != nil {
		t.Fatal(e)
	}
	_, failed := s.ReviewLifecycle(ctx, tenant, "analyst", "skills", id, in)
	if _, e = pool.Exec(ctx, `DROP TRIGGER lifecycle_audit_fail ON audit_events; DROP FUNCTION lifecycle_audit_fail()`); e != nil {
		t.Fatal(e)
	}
	if failed == nil {
		t.Fatal("audit bypass")
	}
	current, e := sk.Material(ctx, tenant, id, mid)
	if e != nil || current["content"] != "Draft reference" || current["version"] != float64(2) {
		t.Fatal("partial restore", current, e)
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", "skills", id, in); e != nil {
		t.Fatal(e)
	}
	current, e = sk.Material(ctx, tenant, id, mid)
	if e != nil || current["content"] != "Original reference" || current["version"] != float64(3) {
		t.Fatal(current, e)
	}
	if _, e = sk.MutateMaterial(ctx, tenant, id, mid, "patch", "analyst", map[string]any{"content": "Approved next reference"}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReviewLifecycle(ctx, tenant, "analyst", "skills", id, LifecycleInput{Operation: "publish-staged", ExpectedVersion: 6, Confirm: true, Rationale: "Approve next saved material release."}); e != nil {
		t.Fatal(e)
	}
	r, e = sk.Get(ctx, tenant, id)
	if e != nil || r["published_materials"].([]any)[0].(map[string]any)["content"] != "Approved next reference" {
		t.Fatal(r, e)
	}
}
