package approvals

import (
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"sync"
	"testing"
)

func TestOwnershipClaimsReassignmentReplayAndNotifications(t *testing.T) {
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
	tenant := "assignment-" + jobs.ID()
	s := Store{Pool: pool}
	sk := skills.Store{Pool: pool}
	defer func() {
		for _, table := range []string{"approval_notifications", "approval_assignments", "skills", "audit_events"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, "DELETE FROM tenants WHERE id=$1", tenant)
	}()
	doc, e := sk.Mutate(ctx, tenant, "", "create", "author", map[string]any{"name": "Independent assignment"})
	if e != nil {
		t.Fatal(e)
	}
	key := WorkKey{Kind: "skill", ID: doc["id"].(string)}
	ops := []auth.ApprovalOperator{{ID: "author", Roles: []string{"proposer", "approver"}}, {ID: "one", Roles: []string{"approver"}}, {ID: "two", Roles: []string{"approver"}}}
	detail, e := s.AssignmentDetail(ctx, tenant, "author", key, ops)
	if e != nil {
		t.Fatal(e)
	}
	token := detail["work_token"].(string)
	inbox, e := s.Inbox(ctx, tenant, "skill", "all", key.ID, 25, 0)
	if e != nil || inbox["items"].([]any)[0].(map[string]any)["work_token"] != token {
		t.Fatal("inconsistent snapshot token", inbox, e)
	}
	in := AssignmentInput{WorkKey: key, Operation: "claim", ExpectedVersion: 0, WorkToken: token, RequestID: jobs.ID(), Reason: "Review the saved instructions independently.", Minutes: 60}
	if _, e = s.Assign(ctx, tenant, "author", in, ops); e == nil {
		t.Fatal("self claim")
	}
	if _, e = s.Assign(ctx, tenant, "forged", in, ops); e == nil {
		t.Fatal("unknown operator")
	}
	foreign := in
	foreign.Operation = "reassign"
	foreign.Owner = "foreign-operator"
	if _, e = s.Assign(ctx, tenant, "author", foreign, ops); e == nil {
		t.Fatal("foreign assignee")
	}
	// Audit failure rolls back ownership and notification creation together.
	if _, e = pool.Exec(ctx, `CREATE FUNCTION assignment_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='approval_claim' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER assignment_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION assignment_audit_failure()`); e != nil {
		t.Fatal(e)
	}
	defer pool.Exec(ctx, "DROP TRIGGER IF EXISTS assignment_audit_failure ON audit_events; DROP FUNCTION IF EXISTS assignment_audit_failure()")
	if _, e = s.Assign(ctx, tenant, "one", in, ops); e == nil {
		t.Fatal("audit failure accepted")
	}
	rolled, e := s.AssignmentDetail(ctx, tenant, "one", key, ops)
	if e != nil || rolled["assignment"].(map[string]any)["version"] != int32(0) {
		t.Fatal("ownership escaped rollback", rolled, e)
	}
	notifications, e := s.Notifications(ctx, tenant, "one", 25, 0)
	if e != nil || notifications["total"] != float64(0) {
		t.Fatal("notification escaped rollback", notifications, e)
	}
	if _, e = pool.Exec(ctx, "DROP TRIGGER assignment_audit_failure ON audit_events; DROP FUNCTION assignment_audit_failure()"); e != nil {
		t.Fatal(e)
	}
	type result struct {
		who     string
		request AssignmentInput
		err     error
	}
	ch := make(chan result, 2)
	var wg sync.WaitGroup
	for _, who := range []string{"one", "two"} {
		wg.Add(1)
		go func(who string) {
			defer wg.Done()
			r := in
			r.RequestID = jobs.ID()
			_, err := s.Assign(ctx, tenant, who, r, ops)
			ch <- result{who, r, err}
		}(who)
	}
	wg.Wait()
	close(ch)
	var winner result
	success := 0
	for r := range ch {
		if r.err == nil {
			winner = r
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent ownership", success)
	}
	replay, e := s.Assign(ctx, tenant, winner.who, winner.request, ops)
	if e != nil || replay["replayed"] != true {
		t.Fatal("claim replay", replay, e)
	}
	notes, e := s.Notifications(ctx, tenant, winner.who, 25, 0)
	if e != nil || notes["total"] != float64(1) {
		t.Fatal("duplicate notifications", notes, e)
	}
	nid := notes["items"].([]any)[0].(map[string]any)["id"].(string)
	if e = s.ReadNotification(ctx, tenant, "author", nid); e == nil {
		t.Fatal("foreign recipient read")
	}
	if e = s.ReadNotification(ctx, tenant+"foreign", winner.who, nid); e == nil {
		t.Fatal("foreign tenant notification")
	}
	if e = s.ReadNotification(ctx, tenant, winner.who, nid); e != nil {
		t.Fatal(e)
	}
	if e = s.ReadNotification(ctx, tenant, winner.who, nid); e != nil {
		t.Fatal("read replay", e)
	}
	loser := "one"
	if winner.who == "one" {
		loser = "two"
	}
	reassign := in
	reassign.Operation = "reassign"
	reassign.Owner = loser
	reassign.ExpectedVersion = 1
	reassign.RequestID = jobs.ID()
	if _, e = s.Assign(ctx, tenant, "author", reassign, ops); e != nil {
		t.Fatal(e)
	}
	claim := in
	claim.RequestID = jobs.ID()
	claim.ExpectedVersion = 2
	if _, e = s.Assign(ctx, tenant, winner.who, claim, ops); e == nil {
		t.Fatal("active owner stolen")
	}
	if _, e = pool.Exec(ctx, "UPDATE approval_assignments SET expires_at=now()-interval '1 second' WHERE tenant_id=$1", tenant); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Assign(ctx, tenant, winner.who, claim, ops); e != nil {
		t.Fatal("expired reclaim", e)
	}
	if _, e = sk.Mutate(ctx, tenant, key.ID, "patch", "author", map[string]any{"description": "Changed proposal"}); e != nil {
		t.Fatal(e)
	}
	inbox, e = s.Inbox(ctx, tenant, "skill", "all", key.ID, 25, 0)
	if e != nil {
		t.Fatal(e)
	}
	item := inbox["items"].([]any)[0].(map[string]any)
	if item["assignment"].(map[string]any)["state"] != "revision_changed" {
		t.Fatal("stale ownership shown current", item)
	}
	claim.ExpectedVersion = 3
	claim.RequestID = jobs.ID()
	if _, e = s.Assign(ctx, tenant, loser, claim, ops); e == nil {
		t.Fatal("stale proposal claim")
	}
	claim.WorkToken = item["work_token"].(string)
	if _, e = s.Assign(ctx, tenant, loser, claim, ops); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AssignmentDetail(ctx, tenant+"foreign", loser, key, ops); e == nil {
		t.Fatal("foreign work")
	}
	// Ownership never bypasses the original self-publication restriction.
	if _, e = sk.Mutate(ctx, tenant, key.ID, "publish", "author", nil); e == nil {
		t.Fatal("assignment bypassed self approval")
	}
	if _, e = sk.Mutate(ctx, tenant, key.ID, "publish", loser, nil); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AssignmentDetail(ctx, tenant, loser, key, ops); e == nil {
		t.Fatal("completed work assignable")
	}
	notes, e = s.Notifications(ctx, tenant, loser, 25, 0)
	if e != nil || notes["total"].(float64) < 1 {
		t.Fatal("handoff history lost", e)
	}
}
