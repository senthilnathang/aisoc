package auth

import (
	"aisoc/backend/internal/platform/config"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Principal struct{ ID, Tenant string }
type principalKey struct{}

func From(ctx context.Context) Principal { p, _ := ctx.Value(principalKey{}).(Principal); return p }

type session struct {
	Principal Principal
	CSRF      string
	Expires   time.Time
}
type Manager struct {
	SourceAuthenticate func(context.Context, string, string) (string, error)
	config             config.Auth
	mu                 sync.Mutex
	sessions           map[string]session
}

var bearerPattern = regexp.MustCompile(`^Bearer [A-Za-z0-9_-]{32,256}$`)
var cookiePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{40,100}$`)

func New(c config.Auth) *Manager { return &Manager{config: c, sessions: map[string]session{}} }
func hash(s string) string       { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func token(r *http.Request) (string, bool) {
	values := r.Header.Values("Authorization")
	if len(values) == 0 {
		return "", true
	}
	if len(values) != 1 || !bearerPattern.MatchString(values[0]) {
		return "", false
	}
	return values[0][7:], true
}
func cookie(r *http.Request) string {
	found := ""
	count := 0
	for _, c := range r.Cookies() {
		if c.Name == "aisoc_session" {
			found = c.Value
			count++
		}
	}
	if count != 1 || !cookiePattern.MatchString(found) {
		return ""
	}
	return found
}
func (m *Manager) get(r *http.Request) (session, bool) {
	key := hash(cookie(r))
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[key]
	if ok && !s.Expires.After(time.Now()) {
		delete(m.sessions, key)
		return session{}, false
	}
	return s, ok
}
func (m *Manager) operator(value string) (Principal, bool) {
	if value == "" {
		return Principal{}, false
	}
	digest := hash(value)
	for _, op := range m.config.Operators {
		if subtle.ConstantTimeCompare([]byte(digest), []byte(op.TokenHash)) == 1 {
			return Principal{op.ID, op.TenantID}, true
		}
	}
	return Principal{}, false
}
func (m *Manager) origin(r *http.Request) bool {
	values := r.Header.Values("Origin")
	if len(values) == 0 {
		return true
	}
	if len(values) != 1 || values[0] == "" {
		return false
	}
	origin := values[0]
	for _, allowed := range m.config.Origins {
		if origin == allowed {
			return true
		}
	}
	return false
}
func deny(w http.ResponseWriter, status int, code, message string) {
	reply(w, status, map[string]any{"error": map[string]any{"code": code, "message": message, "details": nil}})
}
func unauthorized(w http.ResponseWriter) {
	deny(w, 401, "UNAUTHENTICATED", "A valid credential is required.")
}
func bind(w http.ResponseWriter, r *http.Request, p Principal) bool {
	if values, present := r.Header["X-Tenant-Id"]; present && (len(values) != 1 || values[0] != p.Tenant) {
		deny(w, 403, "TENANT_MISMATCH", "The credential does not authorize the requested tenant.")
		return false
	}
	return true
}

func (m *Manager) Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS response headers do not prevent simple browser requests from
		// reaching mutation handlers. Enforce the origin boundary in local mode
		// too, before any public handler or credential-specific branch.
		if !m.origin(r) {
			deny(w, 403, "ORIGIN_DENIED", "This browser origin is not allowed.")
			return
		}
		// Only operational endpoints and the two public auth handlers bypass auth.
		public := r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/metrics" || r.URL.Path == "/api/v1/auth/login" || r.URL.Path == "/api/v1/auth/session"
		if r.Header.Get("Origin") != "" && m.origin(r) {
			w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
			if r.Method == "OPTIONS" {
				w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
				w.WriteHeader(204)
				return
			}
		}
		if public {
			next.ServeHTTP(w, r)
			return
		}
		value, valid := token(r)
		if !valid {
			unauthorized(w)
			return
		}
		parts := strings.Split(r.URL.Path, "/")
		if r.Method == "POST" && len(parts) == 6 && parts[1] == "api" && parts[2] == "v1" && parts[3] == "intake" && (parts[5] == "alerts" || parts[5] == "events") {
			if value == "" || m.SourceAuthenticate == nil {
				unauthorized(w)
				return
			}
			tenant, err := m.SourceAuthenticate(r.Context(), parts[4], value)
			if err != nil {
				deny(w, 500, "INTERNAL_ERROR", "Internal server error")
				return
			}
			if tenant == "" {
				unauthorized(w)
				return
			}
			p := Principal{parts[4], tenant}
			if !bind(w, r, p) {
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
			return
		}
		var p Principal
		if value != "" {
			var ok bool
			p, ok = m.operator(value)
			if !ok {
				unauthorized(w)
				return
			}
			if !bind(w, r, p) {
				return
			}
		} else if m.config.Mode == "local" {
			tenant := strings.TrimSpace(r.Header.Get("X-Tenant-Id"))
			if tenant == "" {
				tenant = m.config.DefaultTenant
			}
			if len(tenant) > 120 {
				deny(w, 400, "VALIDATION_ERROR", "Tenant identifier is too long.")
				return
			}
			p = Principal{"local-development", tenant}
		} else {
			s, ok := m.get(r)
			if !ok {
				unauthorized(w)
				return
			}
			p = s.Principal
			if !bind(w, r, p) {
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
				if !m.origin(r) {
					deny(w, 403, "ORIGIN_DENIED", "This browser origin is not allowed.")
					return
				}
				if subtle.ConstantTimeCompare([]byte(hash(r.Header.Get("X-CSRF-Token"))), []byte(hash(s.CSRF))) != 1 {
					deny(w, 403, "CSRF_INVALID", "Refresh the session before making changes.")
					return
				}
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
	})
}
func (m *Manager) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/session", func(w http.ResponseWriter, r *http.Request) {
		if m.config.Mode == "local" {
			reply(w, 200, map[string]any{"mode": "local", "authenticated": true, "tenant_id": m.config.DefaultTenant})
			return
		}
		if s, ok := m.get(r); ok {
			reply(w, 200, sessionBody(s))
		} else {
			reply(w, 200, map[string]any{"mode": "token", "authenticated": false})
		}
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if !m.origin(r) {
			deny(w, 403, "ORIGIN_DENIED", "This browser origin is not allowed.")
			return
		}
		value, valid := token(r)
		p, ok := m.operator(value)
		if !valid || !ok {
			unauthorized(w)
			return
		}
		if !bind(w, r, p) {
			return
		}
		value, err := random()
		if err != nil {
			deny(w, 500, "INTERNAL_ERROR", "Internal server error")
			return
		}
		csrf, err := random()
		if err != nil {
			deny(w, 500, "INTERNAL_ERROR", "Internal server error")
			return
		}
		now := time.Now()
		s := session{p, csrf, now.Add(m.config.SessionTTL)}
		m.mu.Lock()
		for key, item := range m.sessions {
			if !item.Expires.After(now) {
				delete(m.sessions, key)
			}
		}
		if old := cookie(r); old != "" {
			delete(m.sessions, hash(old))
		}
		if len(m.sessions) >= 1000 {
			m.mu.Unlock()
			deny(w, 503, "SESSION_CAPACITY", "Session capacity reached. Try again later.")
			return
		}
		m.sessions[hash(value)] = s
		m.mu.Unlock()
		w.Header().Set("Set-Cookie", m.cookie(value, int(m.config.SessionTTL/time.Second)))
		reply(w, 200, sessionBody(s))
	})
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		delete(m.sessions, hash(cookie(r)))
		m.mu.Unlock()
		w.Header().Set("Set-Cookie", m.cookie("", 0))
		w.WriteHeader(204)
	})
}
func (m *Manager) cookie(value string, age int) string {
	secure := ""
	if m.config.SecureCookies {
		secure = "; Secure"
	}
	return fmt.Sprintf("aisoc_session=%s; Path=/api; HttpOnly; SameSite=Strict; Max-Age=%d%s", value, age, secure)
}
func random() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b), err
}
func sessionBody(s session) map[string]any {
	return map[string]any{"mode": "token", "authenticated": true, "tenant_id": s.Principal.Tenant, "operator_id": s.Principal.ID, "csrf_token": s.CSRF, "expires_at": s.Expires.UTC().Format("2006-01-02T15:04:05.000Z")}
}
func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
