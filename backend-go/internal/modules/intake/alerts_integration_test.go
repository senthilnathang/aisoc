package intake

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"testing"
	"time"
)

func TestIntakeAtomicityAndCredentialRecheck(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
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
	tenant := "ingest-" + jobs.ID()
	defer func() {
		for _, table := range []string{"investigation_jobs", "alerts", "api_sources", "detection_rules", "investigations", "audit_events"} {
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE tenant_id=$1`, tenant)
		}
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	rules := detection.Store{Pool: pool}
	s := Store{Pool: pool}
	rule, err := rules.Create(ctx, tenant, map[string]any{"name": "Intake", "severity": "high"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := s.Create(ctx, tenant, "Sensor", "Provider", rule["id"].(string), 1, "tester")
	if err != nil {
		t.Fatal(err)
	}
	id := source["source"].(map[string]any)["id"].(string)
	key := source["api_key"].(string)
	input := AlertInput{ExternalID: "event", Title: "Alert", Severity: "high"}
	name := pgx.Identifier{"fail_intake_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' AND NEW.action='alert_received' AND NEW.resource='detection_rules' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = s.IngestSource(ctx, tenant, id, key, input, nil); err == nil {
		t.Fatal("intake survived audit failure")
	}
	operatorInput := input
	operatorInput.Source = "Operator sensor"
	operatorInput.RuleID = rule["id"].(string)
	if _, err = s.IngestOperator(ctx, tenant, operatorInput); err == nil {
		t.Fatal("operator intake survived audit failure")
	}
	for _, table := range []string{"alerts", "investigations", "investigation_jobs"} {
		var n int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 0 {
			t.Fatal("partial intake", table, n, err)
		}
	}
	var document map[string]any
	if err = pool.QueryRow(ctx, `SELECT document FROM detection_rules WHERE tenant_id=$1`, tenant).Scan(&document); err != nil || document["detections"] != float64(0) {
		t.Fatal("counter rollback failed", err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	// The request may have authenticated earlier. Revocation committed while it
	// waits for the source lock must still reject its write transaction.
	lock, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `SELECT id FROM api_sources WHERE id=$1 FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	waiting := make(chan error, 1)
	go func() { _, err := s.IngestSource(ctx, tenant, id, key, input, nil); waiting <- err }()
	if _, err = lock.Exec(ctx, `UPDATE api_sources SET key_hash=NULL,revoked_at=now() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err = lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-waiting:
		var f *fault.Error
		if !errors.As(err, &f) || f.Status != 401 {
			t.Fatal("revoked credential accepted", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("blocked intake")
	}
	rotated, err := s.Mutate(ctx, tenant, id, 1, "tester", false)
	if err != nil {
		t.Fatal(err)
	}
	key = rotated["api_key"].(string)
	if _, err = pool.Exec(ctx, `UPDATE api_sources SET expires_at=now()-interval '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = s.IngestSource(ctx, tenant, id, key, input, nil); err == nil {
		t.Fatal("expired credential accepted")
	}
	rotated, err = s.Mutate(ctx, tenant, id, 1, "tester", false)
	if err != nil {
		t.Fatal(err)
	}
	key = rotated["api_key"].(string)
	committed, err := s.IngestSource(ctx, tenant, id, key, input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if committed["duplicate"] != false {
		t.Fatal("first insert duplicate")
	}
	duplicate, err := s.IngestSource(ctx, tenant, id, key, input, nil)
	if err != nil || duplicate["duplicate"] != true {
		t.Fatal("dedup failed", err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM investigation_jobs WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 1 {
		t.Fatal("duplicate job", err)
	}
}
