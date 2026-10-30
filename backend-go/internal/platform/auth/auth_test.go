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

func testManager() (*Manager, http.Handler) {
	m := New(config.Auth{Mode: "token", DefaultTenant: "demo", Operators: []config.Operator{{ID: "fixture-a", TenantID: "auth-a", TokenHash: hash("parity_fixture_" + strings.Repeat("a", 40))}}, Origins: []string{"http://localhost:8080"}, SessionTTL: time.Hour})
	mux := http.NewServeMux()
	m.Register(mux)
	mux.HandleFunc("GET /protected", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, From(r.Context())) })
	return m, m.Protect(mux)
}
func login(t *testing.T, h http.Handler) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
	r.Header.Set("Authorization", "Bearer parity_fixture_"+strings.Repeat("a", 40))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestSessionExpiryCapacityAndRestart(t *testing.T) {
	m, h := testManager()
	w := login(t, h)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("cookie missing")
	}
	c := cookies[0]
	m.mu.Lock()
	s := m.sessions[hash(c.Value)]
	s.Expires = time.Now().Add(-time.Second)
	m.sessions[hash(c.Value)] = s
	m.mu.Unlock()
	r := httptest.NewRequest("GET", "/protected", nil)
	r.AddCookie(c)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("expired session accepted")
	}
	w = login(t, h)
	r = httptest.NewRequest("GET", "/protected", nil)
	r.AddCookie(w.Result().Cookies()[0])
	_, restarted := testManager()
	w = httptest.NewRecorder()
	restarted.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("session survived manager restart")
	}
	m.mu.Lock()
	m.sessions = map[string]session{}
	for i := 0; i < 1000; i++ {
		m.sessions[string(rune(i))] = session{Expires: time.Now().Add(time.Hour)}
	}
	m.mu.Unlock()
	w = login(t, h)
	if w.Code != 503 {
		t.Fatalf("capacity status %d", w.Code)
	}
}
func TestSuppliedInvalidCredentialNeverFallsBackToLocal(t *testing.T) {
	m, h := testManager()
	m.config.Mode = "local"
	for _, value := range []string{"Bearer bad", "Basic abc", "Bearer " + strings.Repeat("z", 40)} {
		r := httptest.NewRequest("GET", "/protected", nil)
		r.Header.Set("Authorization", value)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatal("invalid token accepted in local mode")
		}
	}
	r := httptest.NewRequest("GET", "/protected", nil)
	r.Header.Set("X-Tenant-Id", "local-a")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var p Principal
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil || p.Tenant != "local-a" {
		t.Fatal("local tenant binding", err)
	}
}

func TestOriginRejectedBeforeLocalOrPublicHandlers(t *testing.T) {
	for _, mode := range []string{"local", "token"} {
		m, _ := testManager()
		m.config.Mode = mode
		calls := 0
		h := m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(204) }))
		for _, path := range []string{"/protected", "/api/v1/auth/login", "/api/v1/auth/session"} {
			for _, origins := range [][]string{{"https://untrusted.example"}, {"null"}, {""}, {"http://localhost:8080", "https://untrusted.example"}} {
				r := httptest.NewRequest("POST", path, strings.NewReader(`{"name":"untrusted"}`))
				r.Header.Set("Content-Type", "text/plain")
				for _, origin := range origins {
					r.Header.Add("Origin", origin)
				}
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				if w.Code != 403 || calls != 0 {
					t.Fatalf("%s %s reached handler: %d", mode, path, w.Code)
				}
			}
		}
	}
	m, _ := testManager()
	m.config.Mode = "local"
	for _, origin := range []string{"", "http://localhost:8080"} {
		r := httptest.NewRequest("POST", "/protected", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })).ServeHTTP(w, r)
		if w.Code != 204 {
			t.Fatal("trusted browser or non-browser client denied", w.Code)
		}
	}
}
