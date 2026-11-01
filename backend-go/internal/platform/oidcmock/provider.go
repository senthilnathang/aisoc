// Package oidcmock is a deliberately unauthenticated, loopback-only test IdP.
// Never use this provider to authenticate real users.
package oidcmock

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type code struct {
	Subject, Nonce, Challenge string
	Expiry                    time.Time
}
type Provider struct {
	Issuer, ClientID, RedirectURL string
	key                           *rsa.PrivateKey
	mu                            sync.Mutex
	codes                         map[string]code
	fault                         string
}

func New(issuer, client, redirect string) (*Provider, error) {
	k, e := rsa.GenerateKey(rand.Reader, 2048)
	return &Provider{Issuer: issuer, ClientID: client, RedirectURL: redirect, key: k, codes: map[string]code{}}, e
}
func (p *Provider) SetFault(v string) { p.mu.Lock(); p.fault = v; p.mu.Unlock() }
func enc(v any) string                { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
func write(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

var form = template.Must(template.New("login").Parse(`<!doctype html><html><head><title>Local mock identity provider</title></head><body><h1>Local mock identity provider</h1><p>Test identities only. No real passwords or provider calls.</p><form method="post">{{range $k,$v := .}}<input type="hidden" name="{{$k}}" value="{{$v}}">{{end}}<label>Test identity <select name="subject"><option>alice</option><option>reviewer</option><option>executor</option><option>foreign</option><option>unmapped</option></select></label><button type="submit">Continue as test identity</button></form></body></html>`))

func (p *Provider) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	switch r.URL.Path {
	case "/.well-known/openid-configuration":
		write(w, map[string]any{"issuer": p.Issuer, "authorization_endpoint": p.Issuer + "/authorize", "token_endpoint": p.Issuer + "/token", "jwks_uri": p.Issuer + "/keys", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}, "code_challenge_methods_supported": []string{"S256"}})
	case "/keys":
		write(w, map[string]any{"keys": []any{map[string]any{"kty": "RSA", "use": "sig", "kid": "local-test-key", "alg": "RS256", "n": base64.RawURLEncoding.EncodeToString(p.key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(p.key.E)).Bytes())}}})
	case "/authorize":
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		if r.ParseForm() != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		f := r.Form
		if f.Get("client_id") != p.ClientID || f.Get("redirect_uri") != p.RedirectURL || f.Get("response_type") != "code" || f.Get("state") == "" || f.Get("nonce") == "" || f.Get("code_challenge_method") != "S256" || len(f.Get("code_challenge")) != 43 {
			http.Error(w, "invalid authorization request", 400)
			return
		}
		if r.Method == "GET" {
			fields := map[string]string{}
			for k := range f {
				fields[k] = f.Get(k)
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			form.Execute(w, fields)
			return
		}
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		subject := f.Get("subject")
		if !strings.Contains("|alice|reviewer|executor|foreign|unmapped|", "|"+subject+"|") || subject == "" {
			http.Error(w, "unknown test identity", 400)
			return
		}
		b := make([]byte, 32)
		if _, e := rand.Read(b); e != nil {
			w.WriteHeader(500)
			return
		}
		key := base64.RawURLEncoding.EncodeToString(b)
		p.mu.Lock()
		for k, v := range p.codes {
			if time.Now().After(v.Expiry) {
				delete(p.codes, k)
			}
		}
		if len(p.codes) >= 1000 {
			p.mu.Unlock()
			w.WriteHeader(503)
			return
		}
		p.codes[key] = code{subject, f.Get("nonce"), f.Get("code_challenge"), time.Now().Add(time.Minute)}
		p.mu.Unlock()
		u, _ := url.Parse(p.RedirectURL)
		q := u.Query()
		q.Set("code", key)
		q.Set("state", f.Get("state"))
		u.RawQuery = q.Encode()
		http.Redirect(w, r, u.String(), http.StatusSeeOther)
	case "/token":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		if r.ParseForm() != nil {
			w.WriteHeader(400)
			return
		}
		p.mu.Lock()
		c, ok := p.codes[r.Form.Get("code")]
		delete(p.codes, r.Form.Get("code"))
		fault := p.fault
		p.mu.Unlock()
		digest := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if !ok || time.Now().After(c.Expiry) || r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("client_id") != p.ClientID || r.Form.Get("redirect_uri") != p.RedirectURL || base64.RawURLEncoding.EncodeToString(digest[:]) != c.Challenge {
			w.WriteHeader(400)
			write(w, map[string]any{"error": "invalid_grant"})
			return
		}
		claims := map[string]any{"iss": p.Issuer, "aud": p.ClientID, "sub": c.Subject, "nonce": c.Nonce, "iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix(), "tenant_id": "untrusted-tenant", "roles": []string{"executor", "approver"}}
		switch fault {
		case "issuer":
			claims["iss"] = "https://wrong.invalid"
		case "audience":
			claims["aud"] = "wrong-client"
		case "expired":
			claims["exp"] = time.Now().Add(-time.Minute).Unix()
		case "nonce":
			claims["nonce"] = "wrong"
		case "future_iat":
			claims["iat"] = time.Now().Add(time.Hour).Unix()
		case "azp":
			claims["aud"] = []string{p.ClientID, "other"}
			claims["azp"] = "other"
		}
		content := enc(map[string]any{"alg": "RS256", "kid": "local-test-key", "typ": "JWT"}) + "." + enc(claims)
		hash := sha256.Sum256([]byte(content))
		sig, e := rsa.SignPKCS1v15(rand.Reader, p.key, crypto.SHA256, hash[:])
		if e != nil {
			w.WriteHeader(500)
			return
		}
		if fault == "signature" {
			sig[0] ^= 1
		}
		write(w, map[string]any{"access_token": "local-mock-not-a-provider-credential", "token_type": "Bearer", "expires_in": 600, "id_token": content + "." + base64.RawURLEncoding.EncodeToString(sig)})
	default:
		http.NotFound(w, r)
	}
}
