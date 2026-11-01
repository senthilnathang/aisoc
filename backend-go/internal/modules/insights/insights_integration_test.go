package insights_test

import (
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInsightLifecycleAndApplications(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "insight-" + jobs.ID()
	s := insights.Store{Pool: pool}
	id := "EI-" + jobs.ID()
	in := insights.Input{ID: id, Artifact: "Executive@example.test", Kind: "user", Content: "Executive account: verify authorization", Hint: "suspicious"}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM enterprise_insights WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM investigations WHERE tenant_id=$1`, tenant)
	r, err := s.Save(ctx, tenant, "analyst", "", in, false)
	if err != nil {
		t.Fatal(err)
	}
	if r["version"] != int32(1) {
		t.Fatal(r)
	}
	if _, err = s.Save(ctx, tenant, "analyst", "", in, false); err != nil {
		t.Fatal("creation replay", err)
	}
	other := in
	other.Content = "different"
	if _, err = s.Save(ctx, tenant, "analyst", "", other, false); err == nil {
		t.Fatal("request collision")
	}
	cases := investigations.Store{Pool: pool}
	makeCase := func(entity string) investigations.Record {
		t.Helper()
		c, e := cases.Create(ctx, tenant, investigations.Input{Title: "Login review", Source: "local", Severity: "high", Status: "closed", Determination: "malicious", PrimaryEntity: entity})
		if e != nil {
			t.Fatal(e)
		}
		return c
	}
	c := makeCase(" executive@example.test ")
	if c.Determination != "malicious" {
		t.Fatal("hint changed verdict")
	}
	for i := 0; i < 2; i++ {
		tx, e := pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		_, e = skills.Apply(ctx, tx, tenant, "investigation", c.ID, skills.Context{Module: "investigations", InsightEntities: []string{"EXECUTIVE@example.test"}})
		if e != nil {
			tx.Rollback(ctx)
			t.Fatal(e)
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
	}
	uses, err := s.Uses(ctx, tenant, id)
	if err != nil || len(uses["items"].([]any)) != 1 {
		t.Fatal("replay usage", uses, err)
	}
	foreign, err := s.Workspace(ctx, tenant+"-foreign", "active", "", 25, 0)
	if err != nil || foreign["total"] != float64(0) {
		t.Fatal("tenant projection", foreign, err)
	}
	in.ExpectedVersion = 1
	in.Content = "Updated context"
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.Save(ctx, tenant, "analyst", id, in, false); results <- e }()
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("lost update", success)
	}
	uses, err = s.Uses(ctx, tenant, id)
	raw, _ := json.Marshal(uses)
	if err != nil || !strings.Contains(string(raw), "Executive account") {
		t.Fatal("snapshot changed", uses)
	}
	if _, err = s.Save(ctx, tenant+"-foreign", "other", id, in, false); err == nil {
		t.Fatal("foreign mutation")
	}
	if _, err = s.Save(ctx, tenant, "analyst", id, insights.Input{ExpectedVersion: 2}, true); err != nil {
		t.Fatal(err)
	}
	makeCase("Executive@example.test")
	uses, err = s.Uses(ctx, tenant, id)
	if err != nil || len(uses["items"].([]any)) != 1 {
		t.Fatal("archived applied", uses, err)
	}
	expired := insights.Input{ID: "EI-" + jobs.ID(), Artifact: "expired.test", Kind: "network", Content: "Expired guidance", ValidUntil: "2000-01-01T00:00:00Z"}
	if _, err = s.Save(ctx, tenant, "analyst", "", expired, false); err != nil {
		t.Fatal(err)
	}
	makeCase("expired.test")
	uses, err = s.Uses(ctx, tenant, expired.ID)
	if err != nil || len(uses["items"].([]any)) != 0 {
		t.Fatal("expired applied", uses, err)
	}
	makeCase("repeat.test")
	makeCase("repeat.test")
	prev, err := s.Workspace(ctx, tenant, "prevalence", "repeat.test", 25, 0)
	if err != nil || prev["total"] != float64(1) {
		t.Fatal("prevalence", prev, err)
	}
	pin := insights.Input{ID: "EI-" + jobs.ID(), Artifact: "repeat.test", Kind: "network", Content: "Reviewed repeated artifact", FromPrevalence: true}
	if _, err = s.Save(ctx, tenant, "analyst", "", pin, false); err != nil {
		t.Fatal(err)
	}
	pin.ID = "EI-" + jobs.ID()
	if _, err = s.Save(ctx, tenant, "analyst", "", pin, false); err == nil {
		t.Fatal("duplicate accepted suggestion")
	}
	prev, err = s.Workspace(ctx, tenant, "prevalence", "repeat.test", 25, 0)
	if err != nil || prev["total"] != float64(0) {
		t.Fatal("accepted suggestion retained", prev, err)
	}
	summary, err := s.Workspace(ctx, tenant, "active", "", 1, 999)
	if err != nil || summary["total"] != float64(2) || len(summary["items"].([]any)) != 0 {
		t.Fatal("offset counts", summary, err)
	}
	// Scope metadata is not an entity value, even when a matching insight exists.
	generic := insights.Input{ID: "EI-" + jobs.ID(), Artifact: "user", Kind: "other", Content: "Only the literal user artifact"}
	if _, err = s.Save(ctx, tenant, "analyst", "", generic, false); err != nil {
		t.Fatal(err)
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, e = skills.Apply(ctx, tx, tenant, "investigation", c.ID, skills.Context{Module: "investigations", SourceEntities: []string{"user"}, InsightEntities: []string{"different@example.test"}})
	if e != nil {
		tx.Rollback(ctx)
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	uses, err = s.Uses(ctx, tenant, generic.ID)
	if err != nil || len(uses["items"].([]any)) != 0 {
		t.Fatal("scope metadata applied insight", uses, err)
	}

	// A different tenant cannot match this context, even given the same entity value.
	tx, e = pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	refs, e := insights.Apply(ctx, tx, tenant+"-foreign", c.ID, []string{"user"})
	tx.Rollback(ctx)
	if e != nil || len(refs) != 0 {
		t.Fatal("foreign match", refs, e)
	}
	// Matching holds a shared row lock until the case snapshot commits.
	concurrent := insights.Input{ID: "EI-" + jobs.ID(), Artifact: "concurrent.test", Kind: "network", Content: "Concurrent context"}
	if _, err = s.Save(ctx, tenant, "analyst", "", concurrent, false); err != nil {
		t.Fatal(err)
	}
	tx, e = pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = insights.Apply(ctx, tx, tenant, c.ID, []string{"concurrent.test"}); e != nil {
		tx.Rollback(ctx)
		t.Fatal(e)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	_, e = s.Save(waitCtx, tenant, "analyst", concurrent.ID, insights.Input{ExpectedVersion: 1}, true)
	cancel()
	if !errors.Is(e, context.DeadlineExceeded) {
		tx.Rollback(ctx)
		t.Fatal("archive bypassed application lock", e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if _, err = s.Save(ctx, tenant, "analyst", concurrent.ID, insights.Input{ExpectedVersion: 1}, true); err != nil {
		t.Fatal(err)
	}
	uses, err = s.Uses(ctx, tenant, concurrent.ID)
	if err != nil || len(uses["items"].([]any)) != 1 {
		t.Fatal("concurrent snapshot lost", uses, err)
	}
	// Audit failure must roll back authoring and the entire case/application transaction.
	fn := pgx.Identifier{"fail_insight_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+fn+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.resource='enterprise_insights' THEN RAISE EXCEPTION 'test insight audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+fn+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+fn+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+fn+`() `); err != nil {
		t.Fatal(err)
	}
	generic.ExpectedVersion = 1
	generic.Content = "Must roll back"
	if _, err = s.Save(ctx, tenant, "analyst", generic.ID, generic, false); err == nil {
		t.Fatal("authoring escaped audit failure")
	}
	var version int
	var content string
	if err = pool.QueryRow(ctx, `SELECT version,document->>'content' FROM enterprise_insights WHERE tenant_id=$1 AND id=$2`, tenant, generic.ID).Scan(&version, &content); err != nil || version != 1 || content == "Must roll back" {
		t.Fatal("authoring rollback", err, version, content)
	}
	var before, after int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM investigations WHERE tenant_id=$1`, tenant).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err = cases.Create(ctx, tenant, investigations.Input{Title: "Audit failure", Source: "local", Severity: "high", Status: "open", Determination: "unknown", PrimaryEntity: "user"}); err == nil {
		t.Fatal("application escaped audit failure")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM investigations WHERE tenant_id=$1`, tenant).Scan(&after); err != nil || before != after {
		t.Fatal("case rollback", before, after, err)
	}
	uses, err = s.Uses(ctx, tenant, generic.ID)
	if err != nil || len(uses["items"].([]any)) != 0 {
		t.Fatal("failed application persisted", uses, err)
	}

}
