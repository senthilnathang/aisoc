package detection

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"testing"
)

func TestRegistrySparseRuleDocument(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "sparse-rule-" + jobs.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM detection_rules WHERE tenant_id=$1`, tenant)
	// This is the exact minimal shape created by the sandbox telemetry intake.
	if _, err = pool.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'mock-stream-login','{"enabled":true,"routing":"Escalate"}',now())`, tenant); err != nil {
		t.Fatal(err)
	}
	store := Store{Pool: pool}
	check := func(record map[string]any) {
		t.Helper()
		if record["id"] != "mock-stream-login" || record["tenant_id"] != tenant || record["name"] != "mock-stream-login" {
			t.Fatalf("missing canonical identity: %#v", record)
		}
		if values, ok := record["mitre_techniques"].([]any); !ok || len(values) != 0 {
			t.Fatalf("invalid techniques: %#v", record["mitre_techniques"])
		}
		if record["routing"] != "Escalate" || record["enabled"] != true {
			t.Fatal("source policy changed")
		}
	}
	result, err := store.Registry(ctx, tenant, RegistryOptions{Limit: 25, Sort: "updated_at", Direction: "desc"})
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 {
		t.Fatalf("items=%v", items)
	}
	check(items[0])
	detail, err := store.Detail(ctx, tenant, "mock-stream-login")
	if err != nil {
		t.Fatal(err)
	}
	check(detail)
	listed, err := store.List(ctx, tenant, "", "", 25, 0)
	if err != nil {
		t.Fatal(err)
	}
	check(listed[0])
	other, err := store.Registry(ctx, tenant+"-other", RegistryOptions{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if other["total"].(int) != 0 {
		t.Fatal("cross-tenant rule leaked")
	}
	var persisted map[string]any
	if err = pool.QueryRow(ctx, `SELECT document FROM detection_rules WHERE tenant_id=$1 AND id='mock-stream-login'`, tenant).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if _, exists := persisted["id"]; exists {
		t.Fatal("read unexpectedly mutated document")
	}
}
