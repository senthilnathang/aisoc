package intake

import (
	"aisoc/backend/internal/modules/detection"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestPhishingWorkerPreservesAnalystDetermination(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tenant := "phishing-worker-" + jobs.ID()
	defer func() {
		for _, table := range []string{"investigation_steps", "case_records", "investigation_jobs", "skill_applications", "alerts", "api_sources", "detection_rules", "investigations", "audit_events"} {
			pool.Exec(ctx, `DELETE FROM `+table+` WHERE tenant_id=$1`, tenant)
		}
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	}()
	s := Store{Pool: pool}
	rule, err := (detection.Store{Pool: pool}).Create(ctx, tenant, map[string]any{"name": "Phishing worker", "severity": "high"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := s.Create(ctx, tenant, "Mock email", "Test", rule["id"].(string), 1, "tester")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"unknown", "benign"} {
		accepted, err := s.IngestSource(ctx, tenant, source["source"].(map[string]any)["id"].(string), source["api_key"].(string), AlertInput{ExternalID: expected, Title: "Phishing review", Severity: "high", Category: "email", AlertType: "credential_phishing"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		id := accepted["alert"].(map[string]any)["investigation_id"].(string)
		if _, err = pool.Exec(ctx, `UPDATE investigations SET determination=$3 WHERE tenant_id=$1 AND id=$2`, tenant, id, expected); err != nil {
			t.Fatal(err)
		}
		completed := false
		for i := 0; i < 20; i++ {
			var state string
			if err = pool.QueryRow(ctx, `SELECT status FROM investigation_jobs WHERE tenant_id=$1 AND investigation_id=$2`, tenant, id).Scan(&state); err != nil {
				t.Fatal(err)
			}
			if state == "completed" {
				completed = true
				break
			}
			if _, err = s.ProcessNext(ctx); err != nil {
				t.Fatal(err)
			}
		}
		if !completed {
			t.Fatal("phishing processing did not complete")
		}
		detail, err := (investigations.Store{Pool: pool}).Get(ctx, tenant, id)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Determination != expected {
			t.Fatalf("worker replaced analyst determination: %s -> %s", expected, detail.Determination)
		}
	}
}
