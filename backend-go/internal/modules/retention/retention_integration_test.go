package retention

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestRetentionSafetyAndRecovery(t *testing.T) {
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
	tenant := "retention-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"retention_snapshots", "retention_policies", "approval_notifications", "audit_events", "investigations"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, "DELETE FROM tenants WHERE id=$1", tenant)
	}()
	if _, e = pool.Exec(ctx, "INSERT INTO tenants(id) VALUES($1)", tenant); e != nil {
		t.Fatal(e)
	}
	seed := func(id string, read bool) {
		t.Helper()
		_, e = pool.Exec(ctx, `INSERT INTO approval_notifications(tenant_id,id,recipient_id,kind,resource_id,title,event_type,actor_id,owner_id,assignment_version,work_token,created_at,read_at) VALUES($1,$2,'owner','memory','memory-1','Synthetic retention notice','claim','owner','owner',1,'token',now()-interval '90 days',CASE WHEN $3 THEN now()-interval '60 days' END)`, tenant, id, read)
		if e != nil {
			t.Fatal(e)
		}
	}
	seed("old", true)
	seed("unread", false)
	preview := func(kind string) map[string]any {
		t.Helper()
		v, e := s.Preview(ctx, tenant, "owner", kind, 0)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	row := func(id string) map[string]any {
		t.Helper()
		for _, r := range preview("notification")["items"].([]map[string]any) {
			if r["id"] == id {
				return r
			}
		}
		t.Fatal("missing row", id)
		return nil
	}
	if row("old")["eligible"] != false {
		t.Fatal("default enabled")
	}
	p, e := s.Configure(ctx, tenant, "owner", PolicyInput{Kind: "notification", Enabled: true, AgeDays: 30, Reason: "Local recovery validation"})
	if e != nil {
		t.Fatal(e)
	}
	if row("unread")["eligible"] != false || row("old")["eligible"] != true {
		t.Fatal("eligibility")
	}
	in := ActionInput{Kind: "notification", ID: "old", Digest: row("old")["digest"].(string), PolicyVersion: p["version"].(int32), Operation: "cleanup", Confirm: true, Reason: "Verify safe local recovery"}
	if _, e = s.Act(ctx, tenant, "owner", in); e == nil {
		t.Fatal("cleanup without archive")
	}
	in.Operation = "archive"
	if _, e = s.Act(ctx, tenant, "other", in); e == nil {
		t.Fatal("recipient scope")
	}
	if _, e = s.Act(ctx, "foreign", "owner", in); e == nil {
		t.Fatal("tenant scope")
	}
	saved, e := s.Act(ctx, tenant, "owner", in)
	if e != nil {
		t.Fatal(e)
	}
	archive := saved["archive"].(map[string]any)
	aid := archive["id"].(string)
	if _, e = s.Snapshot(ctx, tenant, "other", aid); e == nil {
		t.Fatal("foreign recipient archive")
	}
	if _, e = s.Snapshot(ctx, "foreign", "owner", aid); e == nil {
		t.Fatal("foreign tenant archive")
	}
	replay, e := s.Act(ctx, tenant, "owner", in)
	if e != nil || replay["replayed"] != true {
		t.Fatal("archive replay", replay, e)
	}
	// Changed source must fail the exact digest preview, even when still eligible.
	pool.Exec(ctx, "UPDATE approval_notifications SET title='Changed' WHERE tenant_id=$1 AND id='old'", tenant)
	in.Operation = "cleanup"
	if _, e = s.Act(ctx, tenant, "owner", in); e == nil {
		t.Fatal("stale source accepted")
	}
	pool.Exec(ctx, "UPDATE approval_notifications SET title='Synthetic retention notice' WHERE tenant_id=$1 AND id='old'", tenant)
	// A failed audit must roll back deletion of the live notification.
	if _, e = pool.Exec(ctx, `CREATE FUNCTION retention_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='retention_cleanup' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER retention_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION retention_audit_failure()`); e != nil {
		t.Fatal(e)
	}
	defer pool.Exec(ctx, "DROP TRIGGER IF EXISTS retention_audit_failure ON audit_events; DROP FUNCTION IF EXISTS retention_audit_failure()")
	if _, e = s.Act(ctx, tenant, "owner", in); e == nil {
		t.Fatal("cleanup ignored failed audit")
	}
	if len(preview("notification")["items"].([]map[string]any)) != 2 {
		t.Fatal("failed cleanup lost source")
	}
	if _, e = pool.Exec(ctx, "DROP TRIGGER retention_audit_failure ON audit_events; DROP FUNCTION retention_audit_failure()"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Act(ctx, tenant, "owner", in); e != nil {
		t.Fatal(e)
	}
	if len(preview("notification")["items"].([]map[string]any)) != 1 {
		t.Fatal("cleanup did not remove read notice")
	}
	replay, e = s.Act(ctx, tenant, "owner", in)
	if e != nil || replay["replayed"] != true {
		t.Fatal("cleanup replay", e)
	}
	in.Operation = "restore"
	in.ID = aid
	if _, e = s.Act(ctx, tenant, "owner", in); e != nil {
		t.Fatal(e)
	}
	replay, e = s.Act(ctx, tenant, "owner", in)
	if e != nil || replay["replayed"] != true {
		t.Fatal("restore replay", e)
	}
	pool.Exec(ctx, "UPDATE approval_notifications SET title='Newer live notice' WHERE tenant_id=$1 AND id='old'", tenant)
	if _, e = s.Act(ctx, tenant, "owner", in); e == nil {
		t.Fatal("restore overwrote changed source")
	}
	pool.Exec(ctx, "UPDATE retention_snapshots SET document=document||'{\"corrupt\":true}'::jsonb WHERE tenant_id=$1 AND id=$2", tenant, aid)
	if _, e = s.Snapshot(ctx, tenant, "owner", aid); e == nil {
		t.Fatal("corruption accepted")
	}
	if _, e = s.Act(ctx, tenant, "owner", in); e == nil {
		t.Fatal("corrupt restore accepted")
	}
	pool.Exec(ctx, "UPDATE approval_notifications SET title='Synthetic retention notice' WHERE tenant_id=$1 AND id='old'", tenant)
	in.Operation = "archive"
	in.ID = "old"
	if _, e = s.Act(ctx, tenant, "owner", in); e == nil {
		t.Fatal("archive replay returned corrupt snapshot")
	}
	// All areas expose a safe bounded preview, including empty catalogs.
	for _, k := range Kinds {
		preview(k)
	}
	_, e = pool.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,source,severity,status,created_at,updated_at) VALUES($1,'active','Active case','mock','low','open',now()-interval '90 days',now()-interval '90 days'),($1,'closed','Closed case','mock','low','closed',now()-interval '90 days',now()-interval '90 days')`, tenant)
	if e != nil {
		t.Fatal(e)
	}
	p, e = s.Configure(ctx, tenant, "owner", PolicyInput{Kind: "investigation", Enabled: true, AgeDays: 30, Reason: "Archive completed case metadata"})
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range preview("investigation")["items"].([]map[string]any) {
		request := ActionInput{Kind: "investigation", ID: r["id"].(string), Digest: r["digest"].(string), PolicyVersion: p["version"].(int32), Operation: "archive", Confirm: true, Reason: "Preserve completed case metadata"}
		_, e = s.Act(ctx, tenant, "owner", request)
		if request.ID == "active" && e == nil {
			t.Fatal("active archived")
		}
		if request.ID == "closed" && e != nil {
			t.Fatal(e)
		}
		request.Operation = "cleanup"
		if _, e = s.Act(ctx, tenant, "owner", request); e == nil {
			t.Fatal("domain cleanup allowed")
		}
	}
	var count int
	pool.QueryRow(ctx, "SELECT count(*) FROM investigations WHERE tenant_id=$1", tenant).Scan(&count)
	if count != 2 {
		t.Fatal("source evidence removed")
	}
	if _, e = s.Configure(ctx, tenant, "owner", PolicyInput{Kind: "notification", Enabled: false, AgeDays: 30, ExpectedVersion: 0, Reason: "Stale policy update must fail"}); e == nil {
		t.Fatal("stale policy")
	}
}
