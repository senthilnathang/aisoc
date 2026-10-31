package investigations

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestEvidenceChatIsolationIdempotencyAndAudit(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
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
	tenant := "chat-" + jobs.ID()
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"skill_applications", "investigation_steps", "case_records", "investigations", "audit_events"} {
			pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", tenant)
		}
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	c, e := s.Create(ctx, tenant, Input{Title: "Mail evidence", Summary: "Review required", Source: "fixture", Severity: "high", Status: "open", Determination: "unknown"})
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.AddRecord(ctx, tenant, c.ID, "artifacts", map[string]any{"type": "domain", "value": "suspicious.example", "label": "Observed domain"})
	if e != nil {
		t.Fatal(e)
	}
	w, e := s.Workspace(ctx, tenant, c.ID)
	if e != nil || len(w.Nodes) != 2 {
		t.Fatal(w, e)
	}
	input := LookupInput{ID: "message-1", Question: "suspicious.example"}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.AskEvidence(ctx, tenant, c.ID, "analyst", input); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	messages, e := s.EvidenceMessages(ctx, tenant, c.ID, "analyst")
	if e != nil || len(messages) != 1 {
		t.Fatal(messages, e)
	}
	raw, _ := json.Marshal(messages)
	if !strings.Contains(string(raw), "artifact:"+a["id"].(string)) {
		t.Fatal("citation missing", string(raw))
	}
	other, e := s.EvidenceMessages(ctx, tenant, c.ID, "another-analyst")
	if e != nil || len(other) != 0 {
		t.Fatal("actor leak", other, e)
	}
	if _, e = s.Workspace(ctx, tenant+"-other", c.ID); e == nil {
		t.Fatal("foreign workspace")
	}
	if _, e = s.AskEvidence(ctx, tenant+"-other", c.ID, "analyst", input); e == nil {
		t.Fatal("foreign chat")
	}
	if _, e = s.AskEvidence(ctx, tenant, c.ID, "analyst", LookupInput{ID: input.ID, Question: "different question"}); e == nil {
		t.Fatal("conflicting duplicate")
	}
	var count int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='evidence_lookup'`, tenant).Scan(&count); e != nil || count != 1 {
		t.Fatal("duplicate audit", count, e)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO investigation_steps(tenant_id,id,investigation_id,document,created_at) SELECT $1,'step-'||n,$2,jsonb_build_object('id','step-'||n,'title','Recorded step','conclusion',CASE WHEN n=101 THEN 'latest-citation-needle' ELSE 'ordinary' END),now()+n*interval '1 second' FROM generate_series(1,101) n`, tenant, c.ID); err != nil {
		t.Fatal(err)
	}
	workspace, err := s.Workspace(ctx, tenant, c.ID)
	if err != nil || len(workspace.Case.Steps) != 100 || workspace.Case.Steps[99]["id"] != "step-101" {
		t.Fatal("latest workspace steps", err)
	}
	legacy, err := s.Detail(ctx, tenant, c.ID)
	if err != nil || legacy.Steps[0]["id"] != "step-1" {
		t.Fatal("legacy step order changed", err)
	}
	answer, err := s.AskEvidence(ctx, tenant, c.ID, "boundary-reviewer", LookupInput{ID: "latest", Question: "latest-citation-needle"})
	if err != nil || len(answer.Citations) != 1 || answer.Citations[0].Reference != "step:step-101" {
		t.Fatal("latest citation unavailable", answer, err)
	}
	name := pgx.Identifier{"fail_chat_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, e = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='evidence_lookup' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$`); e != nil {
		t.Fatal(e)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, e = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AskEvidence(ctx, tenant, c.ID, "analyst", LookupInput{ID: "must-rollback", Question: "domain"}); e == nil {
		t.Fatal("audit failure saved message")
	}
	messages, e = s.EvidenceMessages(ctx, tenant, c.ID, "analyst")
	if e != nil || len(messages) != 1 {
		t.Fatal("partial save", e)
	}
}
