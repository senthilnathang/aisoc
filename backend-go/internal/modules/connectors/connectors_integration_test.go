package connectors

import (
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestCredentialAtomicityAndConcurrency(t *testing.T) {
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
	tenant := "connectors-" + jobs.ID()
	s := Store{Pool: pool, Key: bytes.Repeat([]byte{7}, 32)}
	defer pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, tenant)
	defer pool.Exec(ctx, `DELETE FROM connectors WHERE tenant_id=$1`, tenant)
	raw := func(v map[string]any) map[string]json.RawMessage {
		r := map[string]json.RawMessage{}
		for k, v := range v {
			r[k], _ = json.Marshal(v)
		}
		return r
	}
	input := raw(map[string]any{"type": "crowdstrike", "name": "Connector", "secret": "fixture-secret"})
	record, err := s.Mutate(ctx, tenant, "", "create", input, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := record["id"].(string)
	read := func() []byte {
		var encrypted []byte
		var public string
		if err := pool.QueryRow(ctx, `SELECT secret_ciphertext,document::text FROM connectors WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&encrypted, &public); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(public, "secret") {
			t.Fatal("credential in public document")
		}
		return encrypted
	}
	encrypted := read()
	plain, err := decrypt(s.Key, encrypted, tenant, id)
	if err != nil || string(plain) != "fixture-secret" {
		t.Fatal("persisted secret cannot be decrypted")
	}
	name := pgx.Identifier{"fail_connector_" + strings.ReplaceAll(jobs.ID(), "-", "")}.Sanitize()
	if _, err = pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+tenant+`' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DROP FUNCTION IF EXISTS `+name+`() CASCADE`)
	if _, err = pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"create", "patch", "test", "delete"} {
		if _, err = s.Mutate(ctx, tenant, id, op, input, []string{"secret", "name"}); err == nil {
			t.Fatal("mutation survived audit failure", op)
		}
	}
	if !bytes.Equal(encrypted, read()) {
		t.Fatal("credential changed despite rollback")
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM connectors WHERE tenant_id=$1`, tenant).Scan(&n); err != nil || n != 1 {
		t.Fatal("partial create", n, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	noKey := Store{Pool: pool}
	if _, err = noKey.Mutate(ctx, tenant, id, "patch", input, nil); err == nil {
		t.Fatal("secret write accepted without key")
	}
	if !bytes.Equal(encrypted, read()) {
		t.Fatal("missing key changed secret")
	}
	if _, err = s.Mutate(ctx, tenant, id, "patch", raw(map[string]any{"secret": nil}), nil); err == nil {
		t.Fatal("null secret accepted")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); _, e := s.Mutate(ctx, tenant, id, "test", nil, nil); errs <- e }()
	go func() {
		defer wg.Done()
		_, e := s.Mutate(ctx, tenant, id, "patch", raw(map[string]any{"name": "Edited", "secret": "rotated-secret"}), []string{"secret", "name"})
		errs <- e
	}()
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	after, err := s.Detail(ctx, tenant, id)
	if err != nil || after["name"] != "Edited" || after["status"] != "untested" {
		t.Fatal("lost edit/test", err)
	}
	plain, err = decrypt(s.Key, read(), tenant, id)
	if err != nil || string(plain) != "rotated-secret" {
		t.Fatal("rotation lost")
	}
	// A new store instance with the same key can recover persisted credentials.
	restarted := Store{Pool: pool, Key: append([]byte(nil), s.Key...)}
	plain, err = decrypt(restarted.Key, read(), tenant, id)
	if err != nil || string(plain) != "rotated-secret" {
		t.Fatal("credential persistence")
	}
	var audit string
	if err = pool.QueryRow(ctx, `SELECT string_agg(details::text,'') FROM audit_events WHERE tenant_id=$1`, tenant).Scan(&audit); err != nil || strings.Contains(audit, "secret") {
		t.Fatal("secret leaked into audit", err)
	}
	for _, op := range []string{"patch", "test", "delete"} {
		if _, err = s.Mutate(ctx, tenant+"-foreign", id, op, nil, nil); err == nil {
			t.Fatal("cross-tenant operation accepted")
		}
	}
	if _, err = s.Mutate(ctx, tenant, id, "patch", raw(map[string]any{"secret": ""}), []string{"secret"}); err != nil {
		t.Fatal(err)
	}
	if len(read()) != 0 {
		t.Fatal("secret not cleared")
	}
	wg.Add(2)
	var deletion error
	go func() { defer wg.Done(); _, _ = s.Mutate(ctx, tenant, id, "test", nil, nil) }()
	go func() { defer wg.Done(); _, deletion = s.Mutate(ctx, tenant, id, "delete", nil, nil) }()
	wg.Wait()
	if deletion != nil {
		t.Fatal(deletion)
	}
	if _, err = s.Detail(ctx, tenant, id); err == nil {
		t.Fatal("record resurrected")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource='connectors'`, tenant).Scan(&n); err != nil || n < 5 {
		t.Fatal("audit retention", n, err)
	}
}
