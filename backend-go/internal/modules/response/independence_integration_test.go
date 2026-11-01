package response

import (
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestThreeIndependentResponseOperators(t *testing.T) {
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
	tenant := "response-approval-" + jobs.ID()
	b := telemetry.Binding{TenantID: tenant, ConnectorID: "mock", Source: "qradar-siem"}
	s := Store{Pool: pool}
	if _, e = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); e != nil {
		t.Fatal(e)
	}
	defer func() {
		for _, table := range []string{"sandbox_session_actions", "sandbox_sessions", "sandbox_response_policy", "audit_events"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, "DELETE FROM tenants WHERE id=$1", tenant)
	}()
	call := func(actor, op string) (map[string]any, error) {
		p := auth.Principal{ID: actor, Tenant: tenant}
		return s.SandboxSession(ctx, p, b, []SandboxGrant{{Actor: p, Binding: b}}, SandboxSessionRequest{Operation: op, ID: "action", SessionID: "session", PrincipalRef: "identity", Ticket: "REVIEW-1", ExpectedVersion: 1, Stopped: false})
	}
	for _, op := range []string{"create_session", "propose"} {
		if _, e = call("author", op); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = call("author", "approve"); e == nil {
		t.Fatal("self approval")
	}
	if _, e = call("reviewer", "approve"); e != nil {
		t.Fatal(e)
	}
	if _, e = call("reviewer", "policy"); e != nil {
		t.Fatal(e)
	}
	for _, actor := range []string{"author", "reviewer"} {
		if _, e = call(actor, "execute"); e == nil {
			t.Fatal("non-independent execution", actor)
		}
	}
	var revoked bool
	if e = pool.QueryRow(ctx, `SELECT revoked FROM sandbox_sessions WHERE tenant_id=$1`, tenant).Scan(&revoked); e != nil || revoked {
		t.Fatal("denial changed session", e)
	}
	if _, e = call("executor", "execute"); e != nil {
		t.Fatal(e)
	}
	if r, e := call("executor", "execute"); e != nil || r["replayed"] != true {
		t.Fatal("execution replay", r, e)
	}
	var a, c, x string
	if e = pool.QueryRow(ctx, `SELECT proposed_by,approved_by,executed_by FROM sandbox_session_actions WHERE tenant_id=$1`, tenant).Scan(&a, &c, &x); e != nil || a != "author" || c != "reviewer" || x != "executor" {
		t.Fatal("actor audit", a, c, x, e)
	}
}
