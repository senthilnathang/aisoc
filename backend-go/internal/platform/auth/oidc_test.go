package auth

import (
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/oidcmock"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type oidcFixture struct {
	app, idp *httptest.Server
	p        *oidcmock.Provider
	m        *Manager
	path     string
	bindings []config.IdentityMapping
}

func newOIDCFixture(t *testing.T) *oidcFixture {
	t.Helper()
	f := &oidcFixture{path: filepath.Join(t.TempDir(), "mappings.json"), bindings: []config.IdentityMapping{{Subject: "alice", OperatorID: "alice-op", TenantID: "tenant-a", Roles: []string{"proposer"}, Generation: 1}, {Subject: "reviewer", OperatorID: "review-op", TenantID: "tenant-a", Roles: []string{"approver"}, Generation: 1}, {Subject: "foreign", OperatorID: "foreign-op", TenantID: "tenant-b", Roles: []string{"approver"}, Generation: 1}}}
	f.save(t)
	var err error
	f.p, err = oidcmock.New("", "client", "")
	if err != nil {
		t.Fatal(err)
	}
	f.idp = httptest.NewServer(f.p)
	f.p.Issuer = f.idp.URL
	f.m = New(config.Auth{Mode: "oidc", SessionTTL: time.Hour, OIDC: &config.OIDC{Issuer: f.idp.URL, ClientID: "client", LocalMock: true, MappingsFile: f.path}})
	mux := http.NewServeMux()
	f.m.Register(mux)
	mux.HandleFunc("GET /api/v1/protected", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, From(r.Context())) })
	mux.HandleFunc("POST /api/v1/skills/x/publish", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	f.app = httptest.NewServer(f.m.Protect(mux))
	f.m.config.Origins = []string{f.app.URL}
	f.m.config.OIDC.RedirectURL = f.app.URL + "/api/v1/auth/oidc/callback"
	f.p.RedirectURL = f.m.config.OIDC.RedirectURL
	t.Cleanup(f.app.Close)
	t.Cleanup(f.idp.Close)
	return f
}
func (f *oidcFixture) save(t *testing.T) {
	t.Helper()
	raw, _ := json.Marshal(f.bindings)
	if e := os.WriteFile(f.path, raw, 0600); e != nil {
		t.Fatal(e)
	}
}
func oidcClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func status(t *testing.T, r *http.Response, e error, want int) *http.Response {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
	if r.StatusCode != want {
		b, _ := io.ReadAll(r.Body)
		r.Body.Close()
		t.Fatalf("status %d want %d: %s", r.StatusCode, want, b)
	}
	return r
}
func (f *oidcFixture) begin(t *testing.T, c *http.Client, subject string) string {
	t.Helper()
	r, e := c.Get(f.app.URL + "/api/v1/auth/oidc/start")
	r = status(t, r, e, 302)
	location := r.Header.Get("Location")
	r.Body.Close()
	u, _ := url.Parse(location)
	q := u.Query()
	q.Set("subject", subject)
	r, e = c.PostForm(f.idp.URL+"/authorize", q)
	r = status(t, r, e, 303)
	callback := r.Header.Get("Location")
	r.Body.Close()
	return callback
}
func (f *oidcFixture) login(t *testing.T, c *http.Client, subject string) {
	t.Helper()
	callback := f.begin(t, c, subject)
	r, e := c.Get(callback)
	status(t, r, e, 303).Body.Close()
}
func (f *oidcFixture) info(t *testing.T, c *http.Client) map[string]any {
	t.Helper()
	r, e := c.Get(f.app.URL + "/api/v1/auth/session")
	r = status(t, r, e, 200)
	defer r.Body.Close()
	var result map[string]any
	if e = json.NewDecoder(r.Body).Decode(&result); e != nil {
		t.Fatal(e)
	}
	return result
}
func post(t *testing.T, c *http.Client, endpoint, csrf string, want int) {
	t.Helper()
	req, _ := http.NewRequest("POST", endpoint, strings.NewReader("{}"))
	req.Header.Set("X-CSRF-Token", csrf)
	req.Header.Set("Content-Type", "application/json")
	r, e := c.Do(req)
	status(t, r, e, want).Body.Close()
}
func TestOIDCProtocolValidation(t *testing.T) {
	f := newOIDCFixture(t)
	for _, fault := range []string{"issuer", "audience", "expired", "nonce", "signature", "azp", "future_iat"} {
		t.Run(fault, func(t *testing.T) {
			f.p.SetFault(fault)
			c := oidcClient()
			callback := f.begin(t, c, "alice")
			r, e := c.Get(callback)
			status(t, r, e, 401).Body.Close()
			if f.info(t, c)["authenticated"] != false {
				t.Fatal("invalid token created session")
			}
		})
	}
	f.p.SetFault("")
	c := oidcClient()
	callback := f.begin(t, c, "alice")
	r, e := oidcClient().Get(callback)
	status(t, r, e, 401).Body.Close()
	r, e = c.Get(callback)
	status(t, r, e, 401).Body.Close()
	callback = f.begin(t, c, "alice")
	r, e = c.Get(callback)
	status(t, r, e, 303).Body.Close()
	r, e = c.Get(callback)
	status(t, r, e, 401).Body.Close()
	callback = f.begin(t, c, "unmapped")
	r, e = c.Get(callback)
	status(t, r, e, 403).Body.Close()
}
func TestOIDCTrustedMappingRevocationAndPermissions(t *testing.T) {
	f := newOIDCFixture(t)
	a, b, review := oidcClient(), oidcClient(), oidcClient()
	f.login(t, a, "alice")
	f.login(t, b, "alice")
	f.login(t, review, "reviewer")
	info := f.info(t, a)
	if info["tenant_id"] != "tenant-a" || info["operator_id"] != "alice-op" || info["mode"] != "oidc" {
		t.Fatal(info)
	}
	roles := info["roles"].([]any)
	if len(roles) != 1 || roles[0] != "proposer" {
		t.Fatal("provider roles trusted")
	}
	post(t, a, f.app.URL+"/api/v1/skills/x/publish", info["csrf_token"].(string), 403)
	post(t, review, f.app.URL+"/api/v1/skills/x/publish", "", 403)
	post(t, review, f.app.URL+"/api/v1/skills/x/publish", f.info(t, review)["csrf_token"].(string), 204)
	req, _ := http.NewRequest("GET", f.app.URL+"/api/v1/protected", nil)
	req.Header.Set("X-Tenant-Id", "tenant-b")
	r, e := a.Do(req)
	status(t, r, e, 403).Body.Close()
	post(t, a, f.app.URL+"/api/v1/auth/logout-all", "", 403)
	post(t, a, f.app.URL+"/api/v1/auth/logout-all", info["csrf_token"].(string), 204)
	for _, client := range []*http.Client{a, b} {
		if f.info(t, client)["authenticated"] != false {
			t.Fatal("session not revoked")
		}
	}
	if f.info(t, review)["authenticated"] != true {
		t.Fatal("revoked unrelated operator")
	}
	f.bindings[1].Roles = []string{"proposer"}
	f.bindings[1].Generation++
	f.save(t)
	if f.info(t, review)["authenticated"] != false {
		t.Fatal("role change did not revoke")
	}
	f.login(t, review, "reviewer")
	post(t, review, f.app.URL+"/api/v1/skills/x/publish", f.info(t, review)["csrf_token"].(string), 403)
	f.bindings[1].Disabled = true
	f.save(t)
	if f.info(t, review)["authenticated"] != false {
		t.Fatal("disabled identity active")
	}
	callback := f.begin(t, review, "reviewer")
	r, e = review.Get(callback)
	status(t, r, e, 403).Body.Close()
	f.login(t, a, "alice")
	f.bindings[0].Generation++
	f.save(t)
	if f.info(t, a)["authenticated"] != false {
		t.Fatal("generation-only revocation failed")
	}
	f.login(t, a, "alice")
	os.WriteFile(f.path, []byte("invalid"), 0600)
	if f.info(t, a)["authenticated"] != false {
		t.Fatal("malformed mapping failed open")
	}
}
func TestOIDCPKCEAndStateExpiry(t *testing.T) {
	f := newOIDCFixture(t)
	c := oidcClient()
	callback := f.begin(t, c, "alice")
	u, _ := url.Parse(callback)
	r, e := c.PostForm(f.idp.URL+"/token", url.Values{"grant_type": {"authorization_code"}, "code": {u.Query().Get("code")}, "client_id": {"client"}, "redirect_uri": {f.p.RedirectURL}, "code_verifier": {"wrong"}})
	status(t, r, e, 400).Body.Close()
	r, e = c.Get(callback)
	status(t, r, e, 401).Body.Close()
	callback = f.begin(t, c, "alice")
	u, _ = url.Parse(callback)
	key := hash(u.Query().Get("state"))
	f.m.oidc.mu.Lock()
	attempt := f.m.oidc.attempts[key]
	attempt.Expires = time.Now().Add(-time.Second)
	f.m.oidc.attempts[key] = attempt
	f.m.oidc.mu.Unlock()
	r, e = c.Get(callback)
	status(t, r, e, 401).Body.Close()
}
