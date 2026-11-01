package skills

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"os"
	"sync"
	"testing"
)

func TestWorkspaceRevisionAndLibrary(t *testing.T) {
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
	tenant := "skill-workspace-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM skills WHERE tenant_id=$1`, tenant)
	a, err := s.Mutate(ctx, tenant, "", "create", "analyst", map[string]any{"name": "Identity guidance", "content_markdown": "Verify evidence"})
	if err != nil {
		t.Fatal(err)
	}
	id := a["id"].(string)
	if _, err = s.Mutate(ctx, tenant, id, "patch", "other", map[string]any{"expected_version": float64(99), "name": "Lost edit"}); err == nil {
		t.Fatal("stale update accepted")
	}
	if _, err = s.Mutate(ctx, tenant, id, "patch", "other", map[string]any{"tenant_id": "foreign"}); err == nil {
		t.Fatal("protected input accepted")
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.Mutate(ctx, tenant, id, "save-publish", "analyst", map[string]any{"expected_version": float64(1), "description": "Reviewed"})
			results <- e
		}()
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
		t.Fatalf("concurrent save success=%d", success)
	}
	a, err = s.Get(ctx, tenant, id)
	if err != nil || a["version"] != float64(2) || a["state"] != "published" || a["description"] != "Reviewed" {
		t.Fatal(a, err)
	}
	if _, err = s.Mutate(ctx, tenant+"other", id, "set-enabled", "other", map[string]any{"expected_version": float64(2), "enabled": false}); err == nil {
		t.Fatal("tenant escape")
	}
	a, err = s.Mutate(ctx, tenant, id, "set-enabled", "analyst", map[string]any{"expected_version": float64(2), "enabled": false})
	if err != nil || a["enabled"] != false {
		t.Fatal(a, err)
	}
	if _, err = s.Mutate(ctx, tenant, id, "set-enabled", "analyst", map[string]any{"expected_version": float64(2), "enabled": true}); err == nil {
		t.Fatal("stale enable accepted")
	}
	for i := 0; i < 26; i++ {
		if _, err = s.Mutate(ctx, tenant, "", "create", "analyst", map[string]any{"name": "Other guidance"}); err != nil {
			t.Fatal(err)
		}
	}
	lib, err := s.Library(ctx, tenant, Options{Limit: 25}, "custom")
	if err != nil {
		t.Fatal(err)
	}
	if lib["total"] != int64(27) || len(lib["items"].([]map[string]any)) != 25 {
		t.Fatal("pagination", lib)
	}
	lib, err = s.Library(ctx, tenant, Options{Limit: 25, Offset: 25}, "custom")
	if err != nil || len(lib["items"].([]map[string]any)) != 2 {
		t.Fatal("next page", lib, err)
	}
	lib, err = s.Library(ctx, tenant, Options{Limit: 25, Search: "Identity"}, "custom")
	if err != nil || lib["total"] != int64(1) {
		t.Fatal("filter", lib, err)
	}
	lib, err = s.Library(ctx, tenant, Options{Limit: 25}, "augmented")
	if err != nil || lib["total"] != int64(0) {
		t.Fatal("origin", lib, err)
	}
	lib, err = s.Library(ctx, tenant+"other", Options{Limit: 25}, "")
	if err != nil || lib["total"] != int64(0) {
		t.Fatal("tenant list", lib, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE skills SET document=jsonb_set(document,'{origin}','"environment_generated"'::jsonb) WHERE tenant_id=$1 AND id=$2`, tenant, id); err != nil {
		t.Fatal(err)
	}
	lib, err = s.Library(ctx, tenant, Options{Limit: 25}, "augmented")
	if err != nil || lib["total"] != int64(1) || lib["published"] != int64(1) {
		t.Fatal("augmented counts", lib, err)
	}

}
