package hunts

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestRegistryPaginationAndTenantIsolation(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tenant := "hunt-registry-" + jobs.ID()
	store := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM hunts WHERE tenant_id=$1`, tenant)
	for _, name := range []string{"Alpha", "Alpha two", "Other"} {
		_, err = store.Mutate(ctx, tenant, "", "create", map[string]json.RawMessage{"name": json.RawMessage(`"` + name + `"`), "query": json.RawMessage(`"192.0.2.42"`)}, nil)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		tenant, search, status      string
		limit, offset, total, count int
	}{
		{tenant, "", "", 2, 0, 3, 2}, {tenant, "", "", 2, 2, 3, 1}, {tenant, "", "", 2, 99, 3, 0},
		{tenant, "alpha", "draft", 1, 0, 2, 1}, {tenant, "192.0.2.42", "", 50, 0, 3, 3},
		{tenant, "' OR 1=1 --", "", 50, 0, 0, 0}, {tenant, "", "completed", 50, 0, 0, 0},
		{tenant + "-foreign", "", "", 50, 0, 0, 0},
	} {
		raw, err := store.Registry(ctx, tc.tenant, tc.search, tc.status, tc.limit, tc.offset)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Items []json.RawMessage `json:"items"`
			Total int               `json:"total"`
		}
		if err = json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
		if result.Total != tc.total || len(result.Items) != tc.count {
			t.Fatalf("%+v: %+v", tc, result)
		}
	}
}
