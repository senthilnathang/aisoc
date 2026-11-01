package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOIDCConfigurationTrustBoundaries(t *testing.T) {
	file := filepath.Join(t.TempDir(), "mapping.json")
	entries := []IdentityMapping{{Subject: "alice", OperatorID: "operator-a", TenantID: "tenant-a", Roles: []string{"proposer"}, Generation: 1}}
	save := func() {
		raw, _ := json.Marshal(entries)
		if e := os.WriteFile(file, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
	save()
	valid := OIDC{Issuer: "http://127.0.0.1:9100", ClientID: "aisoc", RedirectURL: "http://127.0.0.1:8080/api/v1/auth/oidc/callback", MappingsFile: file, LocalMock: true}
	if e := valid.Validate([]string{"http://127.0.0.1:8080"}); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(*OIDC){func(o *OIDC) { o.LocalMock = false }, func(o *OIDC) { o.Issuer = "http://remote.example" }, func(o *OIDC) { o.RedirectURL = "http://127.0.0.1:8080/other" }, func(o *OIDC) {
		o.RedirectURL = "http://127.0.0.1:8080/api/v1/auth/oidc/callback?next=https://evil.invalid"
	}} {
		c := valid
		mutate(&c)
		if c.Validate([]string{"http://127.0.0.1:8080"}) == nil {
			t.Fatal("unsafe configuration accepted")
		}
	}
	if valid.Validate([]string{"http://localhost:8080"}) == nil {
		t.Fatal("unregistered callback origin")
	}
	entries = append(entries, entries[0])
	save()
	if _, e := valid.Mappings(); e == nil {
		t.Fatal("ambiguous subject/operator accepted")
	}
	entries = entries[:1]
	entries[0].Roles = []string{"admin"}
	save()
	if _, e := valid.Mappings(); e == nil {
		t.Fatal("unknown privilege accepted")
	}
	entries[0].Roles = []string{"approver"}
	save()
	os.Chmod(file, 0666)
	if _, e := valid.Mappings(); e == nil {
		t.Fatal("writable-by-others mapping accepted")
	}
}
