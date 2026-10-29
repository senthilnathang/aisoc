package threatintel

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

func TestAtomicityIsolationAndConcurrentChanges(t *testing.T) {
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
	tenant := "threat-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM threat_intel_reports WHERE tenant_id=$1`, tenant)
	raw := func(v map[string]any) map[string]json.RawMessage {
		result := map[string]json.RawMessage{}
		for k, v := range v {
			result[k], _ = json.Marshal(v)
		}
		return result
	}
	report := func() string {
		r, e := s.Mutate(ctx, Reports, tenant, "", "create", raw(map[string]any{"title": "Report", "severity": "high"}), nil)
		if e != nil {
			t.Fatal(e)
		}
		return r["id"].(string)
	}
	first, second := report(), report()
	input := raw(map[string]any{"report_id": first, "indicator_type": "ip", "value": "192.0.2.1"})
	ioc, err := s.Mutate(ctx, Indicators, tenant, "", "create", input, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := ioc["id"].(string)
	if _, err = s.Mutate(ctx, Indicators, tenant+"-foreign", "", "create", input, nil); err == nil {
		t.Fatal("foreign report accepted")
	}
	if _, err = s.Mutate(ctx, Indicators, tenant, id, "patch", raw(map[string]any{"report_id": "missing"}), []string{"report_id"}); err == nil {
		t.Fatal("missing report accepted")
	}
	for _, bad := range []map[string]any{{"published_at": "not-a-date"}, {"ioc_count": 2147483648}, {"severity": "low medium"}, {"status": ""}} {
		if _, err = s.Mutate(ctx, Reports, tenant, first, "patch", raw(bad), nil); err == nil {
			t.Fatal("invalid storage input accepted", bad)
		}
	}
	name := pgx.Identifier{"fail_threat_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	_, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"patch", "launch", "delete"} {
		if _, err = s.Mutate(ctx, Reports, tenant, first, op, raw(map[string]any{"title": "Changed"}), []string{"title"}); err == nil {
			t.Fatal("report mutation survived audit failure", op)
		}
	}
	for _, op := range []string{"create", "patch", "delete"} {
		if _, err = s.Mutate(ctx, Indicators, tenant, id, op, input, []string{"report_id"}); err == nil {
			t.Fatal("indicator mutation survived audit failure", op)
		}
	}
	after, err := s.Detail(ctx, Reports, tenant, first)
	if err != nil || after["title"] != "Report" || after["hunts_launched"] != float64(0) || len(after["indicators"].([]map[string]any)) != 1 {
		t.Fatal("mutation or cascade escaped rollback", after, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.Mutate(ctx, Reports, tenant, first, "launch", nil, nil); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	after, err = s.Detail(ctx, Reports, tenant, first)
	if err != nil || after["hunts_launched"] != float64(20) {
		t.Fatal("lost counter increment", after, err)
	}
	// Delete the old parent while moving its indicator. Either serialized outcome
	// is valid, but no orphan, deadlock, or resurrection is allowed.
	wg.Add(2)
	var deleteErr error
	go func() {
		defer wg.Done()
		_, _ = s.Mutate(ctx, Indicators, tenant, id, "patch", raw(map[string]any{"report_id": second}), []string{"report_id"})
	}()
	go func() { defer wg.Done(); _, deleteErr = s.Mutate(ctx, Reports, tenant, first, "delete", nil, nil) }()
	wg.Wait()
	if deleteErr != nil {
		t.Fatal(deleteErr)
	}
	indicators, err := s.List(ctx, Indicators, tenant, Options{Limit: 500})
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range indicators {
		if i["report_id"] != second {
			t.Fatal("orphan", i)
		}
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='threat_intel_reports' AND resource_id=$2 AND action='updated'`, tenant, first).Scan(&n); err != nil || n != 20 {
		t.Fatal("audit retention", n, err)
	}
	// Legacy dashboard totals intentionally count only the latest 500 per table.
	_, err = pool.Exec(ctx, `INSERT INTO threat_indicators(tenant_id,id,report_id,indicator_type,value,created_at,updated_at) SELECT $1,'cap-'||n,$2,'ip','192.0.2.2',now(),now() FROM generate_series(1,501) n`, tenant, second)
	if err != nil {
		t.Fatal(err)
	}
	dashboard, err := s.Dashboard(ctx, tenant)
	if err != nil || dashboard["totalIndicators"] != 500 {
		t.Fatal("dashboard cap", dashboard, err)
	}
}
