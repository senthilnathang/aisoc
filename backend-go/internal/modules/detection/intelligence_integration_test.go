package detection

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestIntelligenceWindowUTCAndForeignProvider(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	// A single-connection pool makes this session timezone apply to every read.
	if _, err = pool.Exec(ctx, `SET TIME ZONE 'Pacific/Kiritimati'`); err != nil {
		t.Fatal(err)
	}
	tenant := "intel-" + jobs.ID()
	foreign := tenant + "-foreign"
	s := Store{Pool: pool}
	defer func() {
		for _, table := range []string{"alerts", "api_sources", "detection_rules", "investigations", "audit_events"} {
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE tenant_id=ANY($1)`, []string{tenant, foreign})
		}
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=ANY($1)`, []string{tenant, foreign})
	}()
	rule, err := s.Create(ctx, tenant, map[string]any{"name": "Rule", "severity": "low"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Create(ctx, foreign, map[string]any{"name": "Foreign rule", "severity": "low"})
	if err != nil {
		t.Fatal(err)
	}
	foreignSource := "SRC-" + jobs.ID()
	now := time.Now().UTC().Truncate(time.Millisecond)
	if _, err = pool.Exec(ctx, `INSERT INTO api_sources(id,tenant_id,name,provider,rule_id,expires_at,created_at,updated_at) VALUES($1,$2,'Private source','Foreign private provider',$3,$4,$4,$4)`, foreignSource, foreign, other["id"], now); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,source,severity,determination,created_at,updated_at) VALUES($1,'case','Case','Direct','low','benign',$2,$2)`, tenant, now); err != nil {
		t.Fatal(err)
	}
	utcBoundary := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Add(-30 * time.Minute)
	for _, row := range []struct {
		id, source, severity string
		at                   time.Time
		linked               bool
	}{{"fresh1", "Direct", "low", now, true}, {"fresh2", "Direct", "high", now, true}, {"old", "Archived", "low", now.Add(-48 * time.Hour), false}, {"spoof", "api-source:" + foreignSource, "high", now, false}, {"utc", "UTC sensor", "medium", utcBoundary, false}} {
		var caseID any
		disposition := "suppressed"
		routing := "Suppress"
		if row.linked {
			caseID = "case"
			disposition = "investigate"
			routing = "Investigate"
		}
		doc, _ := json.Marshal(map[string]any{"title": row.id, "severity": row.severity, "disposition": disposition, "routing": routing})
		if _, err = pool.Exec(ctx, `INSERT INTO alerts(tenant_id,id,source,external_id,rule_id,investigation_id,document,payload_hash,created_at) VALUES($1,$2,$3,$2,$4,$5,$6,$7,$8)`, tenant, row.id, row.source, rule["id"], caseID, doc, make([]byte, 32), row.at); err != nil {
			t.Fatal(err)
		}
	}
	read := func(days int, source string) map[string]any {
		result, err := s.Intelligence(ctx, tenant, IntelligenceOptions{Days: days, Source: source})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	direct := read(1, "Direct")
	totals := direct["totals"].(map[string]any)
	if totals["total_alerts"] != float64(2) || totals["investigated"] != float64(1) || totals["pending_review"] != float64(0) {
		t.Fatal("distinct case totals incorrect", totals)
	}
	outcomes := direct["outcomes"].([]any)
	if len(outcomes) != 1 || outcomes[0].(map[string]any)["name"] != "benign" || outcomes[0].(map[string]any)["count"] != float64(1) {
		t.Fatal("outcomes not distinct")
	}
	if read(1, "Archived")["totals"].(map[string]any)["total_alerts"] != float64(0) || read(90, "Archived")["totals"].(map[string]any)["total_alerts"] != float64(1) {
		t.Fatal("window cutoff ignored")
	}
	daily := read(90, "UTC sensor")["daily"].([]any)
	if len(daily) != 1 || daily[0].(map[string]any)["date"] != utcBoundary.Format("2006-01-02") {
		t.Fatal("bucket used local instead of UTC date")
	}
	if read(90, "Foreign private provider")["totals"].(map[string]any)["total_alerts"] != float64(0) {
		t.Fatal("foreign provider leaked through filter")
	}
	spoof := read(90, "api-source:"+foreignSource)
	recent := spoof["recent"].([]any)
	if len(recent) != 1 || recent[0].(map[string]any)["source_provider"] != nil {
		t.Fatal("foreign source enriched")
	}
	for _, choice := range spoof["sources"].([]any) {
		if choice == "Foreign private provider" {
			t.Fatal("foreign source choice leaked")
		}
	}
	all := read(90, "")
	if all["totals"].(map[string]any)["total_alerts"] != float64(5) {
		t.Fatal("total mismatch")
	}
}
