package auth

import (
	"aisoc/backend/internal/platform/config"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIndependentRoles(t *testing.T) {
	token := strings.Repeat("p", 40)
	var ops []config.Operator
	json.Unmarshal([]byte(`[{"id":"proposer","tenant_id":"demo","token_hash":"`+hash(token)+`","roles":["proposer"]}]`), &ops)
	m := New(config.Auth{Mode: "local", DefaultTenant: "demo", Operators: ops})
	h := m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tt := range []struct {
		method, path, body string
		status             int
	}{
		{"POST", "/api/v1/skills", `{"name":"draft"}`, 204},
		{"POST", "/api/v1/skills/s/publish", `{}`, 403},
		{"POST", "/api/v1/investigations/i/sandbox-responses", `{"operation":"approve"}`, 403},
		{"POST", "/api/v1/investigations/i/sandbox-responses", `{"operation":"execute"}`, 403},
		{"PATCH", "/api/v1/skills/s/workspace", `{"publish":true}`, 403},
		{"POST", "/api/v1/enterprise-insights/m/lifecycle", `{"operation":"approve"}`, 403},
	} {
		r := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tt.status {
			t.Errorf("%s %s: got %d want %d", tt.method, tt.path, w.Code, tt.status)
		}
	}
	r := httptest.NewRequest("POST", "/api/v1/skills/s/publish", nil)
	r.Header.Set("X-Role", "approver")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("anonymous role spoof: %d", w.Code)
	}
}

func TestRoleMatrixAndLocalCookie(t *testing.T) {
	for _, role := range []string{"proposer", "approver", "executor", ""} {
		t.Run(role, func(t *testing.T) {
			value := strings.Repeat("x", 40)
			roles := []string{}
			if role != "" {
				roles = append(roles, role)
			}
			m := New(config.Auth{Mode: "local", DefaultTenant: "demo", SessionTTL: time.Hour, Operators: []config.Operator{{ID: "operator", TenantID: "demo", TokenHash: hash(value), Roles: roles}}})
			mux := http.NewServeMux()
			m.Register(mux)
			mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
				if From(r.Context()).ID != "operator" {
					t.Error("cookie identity lost in local mode")
				}
				w.WriteHeader(204)
			})
			h := m.Protect(mux)
			r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
			r.Header.Set("Authorization", "Bearer "+value)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 200 {
				t.Fatal(w.Code)
			}
			var info map[string]any
			json.Unmarshal(w.Body.Bytes(), &info)
			cookies := w.Result().Cookies()
			csrf := info["csrf_token"].(string)
			for _, tt := range []struct{ path, body, required string }{
				{"/api/v1/skills", `{"name":"draft"}`, "proposer"},
				{"/api/v1/skills/s/publish", `{}`, "approver"},
				{"/api/v1/investigations/i/sandbox-responses", `{"operation":"execute"}`, "executor"},
				{"/api/v1/enterprise-insights/m/lifecycle", `{"operation":"approve"}`, "approver"},
			} {
				r = httptest.NewRequest("POST", tt.path, strings.NewReader(tt.body))
				r.AddCookie(cookies[0])
				r.Header.Set("X-CSRF-Token", csrf)
				w = httptest.NewRecorder()
				h.ServeHTTP(w, r)
				want := 403
				if role == tt.required {
					want = 204
				}
				if w.Code != want {
					t.Errorf("%s: %d want %d", tt.path, w.Code, want)
				}
			}
			r = httptest.NewRequest("GET", "/api/v1/auth/session", nil)
			r.AddCookie(cookies[0])
			w = httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if !strings.Contains(w.Body.String(), `"operator_id":"operator"`) {
				t.Fatal("local session identity missing")
			}
			r = httptest.NewRequest("POST", "/api/v1/skills", nil)
			r.AddCookie(cookies[0])
			w = httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 403 {
				t.Fatal("local cookie bypassed CSRF")
			}
		})
	}
}
