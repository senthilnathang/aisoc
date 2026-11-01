package build

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestCatalogIsolationAndSafeProjection(t *testing.T) {
	url := os.Getenv("AISOC_GO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
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
	tenant := "build-" + jobs.ID()
	s := Store{Pool: pool}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM skills WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM connectors WHERE tenant_id=$1`, tenant)
	if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1)`, tenant); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 27; i++ {
		doc := map[string]any{"name": fmt.Sprintf("Skill %02d", i), "description": "Tenant-authored guidance", "state": "draft", "enabled": false, "version": 1, "content_markdown": "DO_NOT_EXPOSE_INSTRUCTIONS", "modules": []string{"investigations"}}
		raw, _ := json.Marshal(doc)
		if _, err = pool.Exec(ctx, `INSERT INTO skills(tenant_id,id,document,updated_at) VALUES($1,$2,$3,now())`, tenant, fmt.Sprint(i), raw); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = pool.Exec(ctx, `INSERT INTO connectors(tenant_id,id,document,updated_at) VALUES($1,'private','{"name":"Cribl","type":"cribl","status":"connected","client_id":"DO_NOT_EXPOSE_ID","config":{"password":"DO_NOT_EXPOSE_SECRET"},"workspace_url":"https://private.example"}'::jsonb,now())`, tenant); err != nil {
		t.Fatal(err)
	}

	defer pool.Exec(ctx, "DELETE FROM detection_rules WHERE tenant_id=$1", tenant)
	defer pool.Exec(ctx, "DELETE FROM api_sources WHERE tenant_id=$1", tenant)
	defer pool.Exec(ctx, "DELETE FROM response_plans WHERE tenant_id=$1", tenant)
	if _, err = pool.Exec(ctx, `INSERT INTO detection_rules(tenant_id,id,document,updated_at) VALUES($1,'rule','{"name":"Identity rule","enabled":false}',now())`, tenant); err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"revoked", "expired", "no_key", "key_valid"} {
		if _, err = pool.Exec(ctx, `INSERT INTO api_sources(id,tenant_id,name,provider,rule_id,key_hash,expires_at,revoked_at,created_at,updated_at)
    VALUES($1,$2,$3,'qradar','rule',CASE WHEN $3='no_key' THEN NULL ELSE decode(repeat('ab',32),'hex') END,
    CASE WHEN $3 IN ('revoked','expired') THEN now()-interval '1 day' ELSE now()+interval '1 day' END,
    CASE WHEN $3='revoked' THEN now() ELSE NULL END,now(),now())`, tenant+state, tenant, state); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{"workflow", "runbook"} {
		raw, _ := json.Marshal(map[string]any{"kind": kind, "title": kind, "state": "draft", "version": 1, "steps": []string{"DO_NOT_EXPOSE_BODY"}})
		if _, err = pool.Exec(ctx, `INSERT INTO response_plans(tenant_id,id,document) VALUES($1,$2,$3)`, tenant, kind, raw); err != nil {
			t.Fatal(err)
		}
	}
	sources, err := s.Catalog(ctx, tenant, "api_source", "", 25, 0)
	if err != nil {
		t.Fatal(err)
	}
	if sources["total"] != float64(4) {
		t.Fatal(sources)
	}
	for _, item := range sources["items"].([]any) {
		row := item.(map[string]any)
		if row["name"] != row["state"] {
			t.Fatal("source state precedence", row)
		}
	}
	for _, kind := range []string{"workflow", "runbook"} {
		plans, err := s.Catalog(ctx, tenant, kind, "", 25, 0)
		if err != nil || plans["total"] != float64(1) {
			t.Fatal(kind, plans, err)
		}
	}
	page, err := s.Catalog(ctx, tenant, "skill", "", 25, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page["total"] != float64(27) || len(page["items"].([]any)) != 25 {
		t.Fatal("totals", page)
	}
	page, err = s.Catalog(ctx, tenant, "skill", "", 25, 25)
	if err != nil || len(page["items"].([]any)) != 2 {
		t.Fatal("pagination", page, err)
	}
	page, err = s.Catalog(ctx, tenant, "all", "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(page)
	for _, secret := range []string{"DO_NOT_EXPOSE", "private.example", "client_id", "password", "key_hash", "secret_ciphertext"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("secret/config leaked", secret)
		}
	}
	page, err = s.Catalog(ctx, tenant+"foreign", "all", "", 25, 0)
	if err != nil || page["total"] != float64(0) {
		t.Fatal("tenant leak", page, err)
	}
	page, err = s.Catalog(ctx, tenant, "all", "%", 25, 0)
	if err != nil || page["total"] != float64(0) {
		t.Fatal("wildcard search", page, err)
	}
	page, err = s.Catalog(ctx, tenant, "skill", "Skill 00", 25, 999)
	if err != nil || page["total"] != float64(1) || len(page["items"].([]any)) != 0 {
		t.Fatal("empty page total", page, err)
	}
}
