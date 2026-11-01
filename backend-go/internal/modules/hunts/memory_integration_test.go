package hunts

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestMemorySnapshotsFreshnessReplayAndPromotion(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
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
	tenant := "hunt-memory-" + jobs.ID()
	s := Store{Pool: pool}
	memory := insights.Store{Pool: pool}
	defer func() {
		pool.Exec(ctx, `DELETE FROM hunt_promotions WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM enterprise_insights WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	h, err := s.Mutate(ctx, tenant, "", "create", map[string]json.RawMessage{"name": json.RawMessage(`"Memory hunt"`), "query": json.RawMessage(`"memory-user"`)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := h["id"].(string)
	expected := h["updated_at"].(string)
	c, err := (investigations.Store{Pool: pool}).Create(ctx, tenant, investigations.Input{Title: "memory-user login", PrimaryEntity: "memory-user", Summary: "Local evidence", Source: "mock", Category: "identity", Severity: "medium", Status: "resolved", Determination: "suspicious", InsightRefs: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	input := insights.Input{ID: "EI-" + jobs.ID(), Artifact: " MEMORY-USER ", Kind: "user", Content: "Review current MFA; this context is advisory.", Hint: "benign", ValidUntil: now.Add(time.Hour).Format(time.RFC3339)}
	saved, err := memory.Save(ctx, tenant, "analyst", "", input, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"expired", "future", "archived", "unapproved", "source-stale"} {
		copy := input
		copy.ID = "EI-" + jobs.ID()
		if kind == "expired" {
			copy.ValidUntil = now.Add(-time.Hour).Format(time.RFC3339)
		}
		if kind == "future" {
			copy.ValidFrom = now.Add(time.Minute).Format(time.RFC3339)
		}
		item, e := memory.Save(ctx, tenant, "analyst", "", copy, false)
		if e != nil {
			t.Fatal(e)
		}
		mid := item["id"].(string)
		if kind == "archived" {
			_, e = memory.Save(ctx, tenant, "analyst", mid, insights.Input{ExpectedVersion: 1}, true)
		}
		if kind == "unapproved" {
			_, e = pool.Exec(ctx, `UPDATE enterprise_insights SET document=document-'created_by' WHERE tenant_id=$1 AND id=$2`, tenant, mid)
		}
		if kind == "source-stale" {
			_, e = pool.Exec(ctx, `UPDATE enterprise_insights SET document=document||jsonb_build_object('learning_origin',jsonb_build_object('source_case',jsonb_build_object('id',$3::text,'updated_at','outdated'))) WHERE tenant_id=$1 AND id=$2`, tenant, mid, c.ID)
		}
		if e != nil {
			t.Fatal(e)
		}
	}
	run, err := s.Search(ctx, tenant, id, "analyst", "memory-run", expected)
	if err != nil {
		t.Fatal(err)
	}
	if len(run.Memory) != 1 || run.Memory[0]["id"] != saved["id"] || run.Verdict != "review_required" {
		t.Fatalf("eligible snapshots: %+v", run)
	}
	if len(run.Findings) != 1 {
		t.Fatal(run.Findings)
	}
	// Audit failure must roll back both the immutable run and Memory usage.
	constraint := "memory_hunt_" + jobs.ID()[:8]
	if _, err = pool.Exec(ctx, `ALTER TABLE audit_events ADD CONSTRAINT `+constraint+` CHECK (tenant_id <> '`+tenant+`' OR action <> 'applied_to_hunt') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	_, failed := s.Search(ctx, tenant, id, "analyst", "audit-failure", expected)
	_, dropErr := pool.Exec(ctx, `ALTER TABLE audit_events DROP CONSTRAINT `+constraint)
	if failed == nil || dropErr != nil {
		t.Fatal("audit failure not atomic", failed, dropErr)
	}
	workspace, err := s.Workspace(ctx, tenant, id)
	if err != nil || len(workspace.Runs) != 1 {
		t.Fatal("failed run retained", workspace, err)
	}
	before, _ := json.Marshal(run.Memory)
	input.ExpectedVersion = 1
	input.Content = "Changed current context"
	input.ValidUntil = now.Add(-time.Minute).Format(time.RFC3339)
	if _, err = memory.Save(ctx, tenant, "analyst", input.ID, input, false); err != nil {
		t.Fatal(err)
	}
	replay, err := s.Search(ctx, tenant, id, "analyst", "memory-run", expected)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(replay.Memory)
	if string(before) != string(after) {
		t.Fatal("historical snapshot changed")
	}
	next, err := s.Search(ctx, tenant, id, "analyst", "next-run", expected)
	if err != nil || len(next.Memory) != 0 {
		t.Fatal("expired memory reused", next, err)
	}
	promoted, err := s.Promote(ctx, tenant, id, "analyst", PromoteInput{RunID: run.ID, RecordID: run.Findings[0].RecordID, Kind: run.Findings[0].Kind, Comment: "Reviewed local evidence; context is historical.", Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(promoted.Memory)
	if string(encoded) != string(before) {
		t.Fatal("promotion lost original context")
	}
	uses, err := memory.Uses(ctx, tenant, input.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(uses["hunt_items"].([]any)) != 1 {
		t.Fatal("missing hunt use", uses)
	}
	foreign, err := memory.Uses(ctx, "foreign", input.ID)
	if err != nil || !reflect.DeepEqual(foreign["hunt_items"], []any{}) {
		t.Fatal("foreign uses", foreign, err)
	}
	// Context volume is bounded independently of evidence and never changes verdicts.
	for i := 0; i < 21; i++ {
		bounded := input
		bounded.ID = "EI-" + jobs.ID()
		bounded.ExpectedVersion = 0
		bounded.ValidUntil = now.Add(time.Hour).Format(time.RFC3339)
		if _, err = memory.Save(ctx, tenant, "analyst", "", bounded, false); err != nil {
			t.Fatal(err)
		}
	}
	bounded, err := s.Search(ctx, tenant, id, "analyst", "bounded-memory", expected)
	if err != nil || len(bounded.Memory) != 20 || !bounded.MemoryTruncated || bounded.Verdict != run.Verdict {
		t.Fatal("unbounded context or changed verdict", bounded, err)
	}

	if _, err = pool.Exec(ctx, `UPDATE enterprise_insights SET document=jsonb_set(document,'{content}',to_jsonb(repeat('x',8000))) WHERE tenant_id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	bytesBounded, err := s.Search(ctx, tenant, id, "analyst", "byte-bounded-memory", expected)
	payload, _ := json.Marshal(bytesBounded.Memory)
	if err != nil || !bytesBounded.MemoryTruncated || len(payload) > 65536 || len(bytesBounded.Memory) == 0 {
		t.Fatal("context byte bound", len(payload), err)
	}

}
