package localintegrations

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestBatchPartialFailureQuotaRepairAndRecovery(t *testing.T) {
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
	tenant := "bulk-" + jobs.ID()
	s := Store{Pool: pool, MaxProfiles: 1, MaxBatches: 1}
	defer func() {
		for _, table := range []string{"local_import_batch_items", "local_import_batches", "stream_outbox", "stream_events", "stream_checkpoints", "local_integration_profiles", "audit_events"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, "DELETE FROM tenants WHERE id=$1", tenant)
	}()
	raw, e := os.ReadFile("../../../../examples/scenarios/suspicious-login/events.json")
	if e != nil {
		t.Fatal(e)
	}
	d := Document{SchemaVersion: "1"}
	if e = json.Unmarshal(raw, &d.Events); e != nil {
		t.Fatal(e)
	}
	for i := range d.Events {
		d.Events[i].TenantID = tenant
	}
	raw, _ = json.Marshal(d)
	in := BatchInput{SchemaVersion: "1", ID: "batch-" + jobs.ID(), ScopeID: "grant", Name: "Partial batch", Cases: []BatchCase{{Key: "a", Name: "First", Document: raw}, {Key: "b", Name: "Second", Document: raw}, {Key: "c", Name: "Repair", Document: json.RawMessage(`{"schema_version":"1","events":[]}`)}}}
	v, e := s.CreateBatch(ctx, tenant, "actor", in)
	if e != nil {
		t.Fatal(e)
	}
	if v["counts"].(map[string]int)["invalid"] != 1 {
		t.Fatal(v)
	}
	v, e = s.CreateBatch(ctx, tenant, "actor", in)
	if e != nil || v["replayed"] != true {
		t.Fatal("create replay", v, e)
	}
	conflict := in
	conflict.Name = "Different"
	if _, e = s.CreateBatch(ctx, tenant, "actor", conflict); e == nil {
		t.Fatal("changed replay")
	}
	extra := in
	extra.ID = "batch-" + jobs.ID()
	if _, e = s.CreateBatch(ctx, tenant, "actor", extra); e == nil {
		t.Fatal("batch quota")
	}
	if _, e = s.Batch(ctx, tenant+"foreign", in.ID); e == nil {
		t.Fatal("foreign tenant")
	}
	if _, e = s.ProcessBatch(ctx, tenant, "actor", in.ID, map[string]int32{"a": 99, "b": 1, "c": 1}); e == nil {
		t.Fatal("stale intake confirmation")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 3)
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.ProcessBatch(ctx, tenant, "actor", in.ID); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	v, e = s.Batch(ctx, tenant, in.ID)
	if e != nil {
		t.Fatal(e)
	}
	counts := v["counts"].(map[string]int)
	if counts["accepted"] != 1 || counts["failed"] != 1 || counts["invalid"] != 1 {
		t.Fatal("partial", v)
	}
	var events int
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM stream_events WHERE tenant_id=$1", tenant).Scan(&events); e != nil || events != 4 {
		t.Fatal("duplicate delivery", events, e)
	}
	// Repair is allowed only before a profile exists; expected revision prevents stale edits.
	c := BatchCase{Key: "c", Name: "Repaired", Document: raw}
	if _, e = s.RepairBatchCase(ctx, tenant, "actor", in.ID, "c", 1, c); e != nil {
		t.Fatal(e)
	}
	if _, e = s.RepairBatchCase(ctx, tenant, "actor", in.ID, "c", 1, c); e != nil {
		t.Fatal("lost repair replay", e)
	}
	changed := c
	changed.Name = "Changed"
	if _, e = s.RepairBatchCase(ctx, tenant, "actor", in.ID, "c", 1, changed); e == nil {
		t.Fatal("stale repair")
	}
	s.MaxProfiles = 3
	if _, e = s.ProcessBatch(ctx, tenant, "actor", in.ID); e != nil {
		t.Fatal(e)
	}
	v, e = s.Batch(ctx, tenant, in.ID)
	if e != nil || v["counts"].(map[string]int)["accepted"] != 3 {
		t.Fatal("recovered", v, e)
	}
	if _, e = s.RepairBatchCase(ctx, tenant, "actor", in.ID, "a", 1, c); e == nil {
		t.Fatal("accepted repair")
	}
	// Simulate a crash after durable intake but before the batch receipt commits.
	if _, e = pool.Exec(ctx, "UPDATE local_import_batch_items SET state='running',lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND case_key='a'", tenant); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ProcessBatch(ctx, tenant, "actor", in.ID); e != nil {
		t.Fatal(e)
	}
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM stream_events WHERE tenant_id=$1", tenant).Scan(&events); e != nil || events != 12 {
		t.Fatal("replay duplicated", events, e)
	}
	// An archive does not reclaim retained-profile quota.
	if _, e = s.Archive(ctx, tenant, "actor", profileFor(tenant, in.ID, "a"), 1); e == nil {
		t.Fatal("unfinished archive allowed")
	}
	if _, e = s.Save(ctx, tenant, "actor", "build-"+jobs.ID(), "grant", "Overflow", 0, d); e == nil {
		t.Fatal("profile quota")
	}
}
