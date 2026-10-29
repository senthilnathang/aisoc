package skills

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestAuthoringAtomicityAndMaterialConcurrency(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 12)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "skills-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM skills WHERE tenant_id=$1`, tenant)
	r, err := s.Mutate(ctx, tenant, "", "create", "actor", map[string]any{"name": "Skill"})
	if err != nil {
		t.Fatal(err)
	}
	id := r["id"].(string)
	input := map[string]any{"name": "file.txt", "content": "Initial"}
	m, err := s.MutateMaterial(ctx, tenant, id, "", "create", "actor", input)
	if err != nil {
		t.Fatal(err)
	}
	mid := m["id"].(string)
	name := pgx.Identifier{"fail_skill_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"patch", "publish"} {
		if _, err = s.Mutate(ctx, tenant, id, op, "actor", map[string]any{"name": "Changed"}); err == nil {
			t.Fatal("skill mutation escaped audit failure")
		}
	}
	for _, op := range []string{"create", "patch", "delete"} {
		if _, err = s.MutateMaterial(ctx, tenant, id, mid, op, "actor", input); err == nil {
			t.Fatal("material mutation escaped audit failure")
		}
	}
	r, err = s.Get(ctx, tenant, id)
	if err != nil || r["version"] != float64(2) || r["name"] != "Skill" {
		t.Fatal("parent rollback", r, err)
	}
	m, err = s.Material(ctx, tenant, id, mid)
	if err != nil || m["version"] != float64(1) || m["archived_at"] != nil {
		t.Fatal("material rollback")
	}
	vs, err := s.Versions(ctx, tenant, id, mid)
	if err != nil || len(vs["items"].([]map[string]any)) != 1 {
		t.Fatal("snapshot rollback")
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	out := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.MutateMaterial(ctx, tenant, id, "", "create", "actor", input)
			out <- e
		}()
	}
	wg.Wait()
	close(out)
	success := 0
	for e := range out {
		if e == nil {
			success++
		}
	}
	if success != 9 {
		t.Fatalf("material limit race: %d accepted", success)
	}
	r, err = s.Get(ctx, tenant, id)
	if err != nil || r["version"] != float64(11) {
		t.Fatal("lost parent revisions", r, err)
	}
	errs := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, e := s.MutateMaterial(ctx, tenant, id, mid, "patch", "actor", map[string]any{"content": "Changed"})
		errs <- e
	}()
	go func() {
		defer wg.Done()
		_, e := s.MutateMaterial(ctx, tenant, id, mid, "patch", "actor", map[string]any{"name": "Renamed"})
		errs <- e
	}()
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	m, err = s.Material(ctx, tenant, id, mid)
	if err != nil || m["version"] != float64(3) || m["name"] != "Renamed" || m["content"] != "Changed" {
		t.Fatal("lost concurrent material edit", m, err)
	}
	if _, err = s.MutateMaterial(ctx, tenant+"-foreign", id, mid, "patch", "actor", input); err == nil {
		t.Fatal("foreign material mutation")
	}
	if _, err = s.Mutate(ctx, tenant, id, "delete", "actor", nil); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM skill_material_versions WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 0 {
		t.Fatal("snapshot cascade")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n < 13 {
		t.Fatal("history lost")
	}
}
