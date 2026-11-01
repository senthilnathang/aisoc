package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sync"
	"time"

	"aisoc/backend/internal/platform/config"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type oidcAttempt struct {
	State, Browser, Nonce, Verifier string
	Expires                         time.Time
}
type oidcRuntime struct {
	mu       sync.Mutex
	provider *oidc.Provider
	client   *http.Client
	attempts map[string]oidcAttempt
}
type issuerTransport struct{ origin string }

func (t issuerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme+"://"+r.URL.Host != t.origin {
		return nil, errors.New("OIDC endpoint outside configured issuer origin")
	}
	return http.DefaultTransport.RoundTrip(r)
}
func (m *Manager) oidcProvider(ctx context.Context) (*oidc.Provider, *http.Client, error) {
	o := m.config.OIDC
	if o == nil || m.config.Mode != "oidc" {
		return nil, nil, errors.New("SSO disabled")
	}
	m.oidc.mu.Lock()
	defer m.oidc.mu.Unlock()
	if m.oidc.provider != nil {
		return m.oidc.provider, m.oidc.client, nil
	}
	u, _ := url.Parse(o.Issuer)
	client := &http.Client{Timeout: 8 * time.Second, Transport: issuerTransport{u.Scheme + "://" + u.Host}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	p, e := oidc.NewProvider(oidc.ClientContext(ctx, client), o.Issuer)
	if e != nil {
		return nil, nil, e
	}
	for _, endpoint := range []string{p.Endpoint().AuthURL, p.Endpoint().TokenURL} {
		v, e := url.Parse(endpoint)
		if e != nil || v.User != nil || v.Scheme+"://"+v.Host != u.Scheme+"://"+u.Host {
			return nil, nil, errors.New("invalid provider endpoints")
		}
	}
	m.oidc.provider = p
	m.oidc.client = client
	return p, client, nil
}
func mappingHash(b config.IdentityMapping) string {
	raw, _ := json.Marshal(b)
	return hash(string(raw))
}
func (m *Manager) mapping(subject string) (config.IdentityMapping, bool) {
	if m.config.OIDC == nil {
		return config.IdentityMapping{}, false
	}
	list, e := m.config.OIDC.Mappings()
	if e != nil {
		return config.IdentityMapping{}, false
	}
	for _, b := range list {
		if b.Subject == subject && !b.Disabled {
			return b, true
		}
	}
	return config.IdentityMapping{}, false
}
func (m *Manager) oidcOperators() []config.Operator {
	list, e := m.config.OIDC.Mappings()
	if e != nil {
		return nil
	}
	out := []config.Operator{}
	for _, b := range list {
		if !b.Disabled {
			out = append(out, config.Operator{ID: b.OperatorID, TenantID: b.TenantID, Roles: b.Roles})
		}
	}
	return out
}
func (m *Manager) oidcCookie(value string, age int) *http.Cookie {
	return &http.Cookie{Name: "aisoc_oidc", Value: value, Path: "/api/v1/auth/oidc", HttpOnly: true, Secure: m.config.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: age}
}
func (m *Manager) registerOIDC(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/oidc/start", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		p, _, e := m.oidcProvider(r.Context())
		if e != nil {
			deny(w, 503, "SSO_UNAVAILABLE", "SSO is unavailable.")
			return
		}
		state, e := random()
		if e != nil {
			unauthorized(w)
			return
		}
		browser, e := random()
		if e != nil {
			unauthorized(w)
			return
		}
		nonce, e := random()
		if e != nil {
			unauthorized(w)
			return
		}
		verifier := oauth2.GenerateVerifier()
		m.oidc.mu.Lock()
		for k, a := range m.oidc.attempts {
			if time.Now().After(a.Expires) {
				delete(m.oidc.attempts, k)
			}
		}
		if len(m.oidc.attempts) >= 1000 {
			m.oidc.mu.Unlock()
			deny(w, 503, "SSO_CAPACITY", "Try again later.")
			return
		}
		m.oidc.attempts[hash(state)] = oidcAttempt{state, hash(browser), nonce, verifier, time.Now().Add(5 * time.Minute)}
		m.oidc.mu.Unlock()
		o := m.config.OIDC
		c := oauth2.Config{ClientID: o.ClientID, RedirectURL: o.RedirectURL, Endpoint: p.Endpoint(), Scopes: []string{oidc.ScopeOpenID}}
		http.SetCookie(w, m.oidcCookie(browser, 300))
		http.Redirect(w, r, c.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), http.StatusFound)
	})
	mux.HandleFunc("GET /api/v1/auth/oidc/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if m.config.Mode != "oidc" {
			unauthorized(w)
			return
		}
		state := r.URL.Query().Get("state")
		m.oidc.mu.Lock()
		a, ok := m.oidc.attempts[hash(state)]
		delete(m.oidc.attempts, hash(state))
		m.oidc.mu.Unlock()
		cookies := r.CookiesNamed("aisoc_oidc")
		http.SetCookie(w, m.oidcCookie("", -1))
		if !ok || time.Now().After(a.Expires) || len(cookies) != 1 || subtle.ConstantTimeCompare([]byte(a.Browser), []byte(hash(cookies[0].Value))) != 1 || len(r.URL.Query()["state"]) != 1 || len(r.URL.Query()["code"]) != 1 || r.URL.Query().Get("error") != "" {
			unauthorized(w)
			return
		}
		p, client, e := m.oidcProvider(r.Context())
		if e != nil {
			unauthorized(w)
			return
		}
		o := m.config.OIDC
		endpoint := p.Endpoint()
		endpoint.AuthStyle = oauth2.AuthStyleInParams
		c := oauth2.Config{ClientID: o.ClientID, ClientSecret: o.ClientSecret, RedirectURL: o.RedirectURL, Endpoint: endpoint}
		ctx := oidc.ClientContext(r.Context(), client)
		token, e := c.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(a.Verifier))
		if e != nil {
			unauthorized(w)
			return
		}
		raw, ok := token.Extra("id_token").(string)
		if !ok {
			unauthorized(w)
			return
		}
		verified, e := p.VerifierContext(oidc.ClientContext(context.Background(), client), &oidc.Config{ClientID: o.ClientID, SupportedSigningAlgs: []string{oidc.RS256}}).Verify(ctx, raw)
		if e != nil || verified.Subject == "" || verified.Nonce != a.Nonce || verified.IssuedAt.IsZero() || verified.IssuedAt.After(time.Now().Add(time.Minute)) || verified.Expiry.Before(verified.IssuedAt) {
			unauthorized(w)
			return
		}
		var claims struct {
			AZP string `json:"azp"`
		}
		if verified.Claims(&claims) != nil || ((len(verified.Audience) > 1 || claims.AZP != "") && claims.AZP != o.ClientID) {
			unauthorized(w)
			return
		}
		binding, ok := m.mapping(verified.Subject)
		if !ok {
			deny(w, 403, "SSO_UNMAPPED", "This identity has no active workspace mapping.")
			return
		}
		expiry := time.Now().Add(m.config.SessionTTL)
		if verified.Expiry.Before(expiry) {
			expiry = verified.Expiry
		}
		value, e := random()
		if e != nil {
			unauthorized(w)
			return
		}
		csrf, e := random()
		if e != nil {
			unauthorized(w)
			return
		}
		s := session{Principal: Principal{binding.OperatorID, binding.TenantID}, CSRF: csrf, Expires: expiry, Subject: binding.Subject, MappingHash: mappingHash(binding)}
		m.mu.Lock()
		for key, item := range m.sessions {
			if !item.Expires.After(time.Now()) {
				delete(m.sessions, key)
			}
		}
		if len(m.sessions) >= 1000 {
			m.mu.Unlock()
			deny(w, 503, "SESSION_CAPACITY", "Try again later.")
			return
		}
		delete(m.sessions, hash(cookie(r)))
		m.sessions[hash(value)] = s
		m.mu.Unlock()
		if m.SessionEvent != nil {
			m.SessionEvent(s.Principal, "oidc_login")
		}
		w.Header().Add("Set-Cookie", m.cookie(value, int(time.Until(expiry)/time.Second)))
		http.Redirect(w, r, "/", http.StatusSeeOther)
	})
	mux.HandleFunc("POST /api/v1/auth/logout-all", func(w http.ResponseWriter, r *http.Request) {
		p := From(r.Context())
		m.mu.Lock()
		for key, s := range m.sessions {
			if s.Principal == p {
				delete(m.sessions, key)
			}
		}
		m.mu.Unlock()
		if m.SessionEvent != nil {
			m.SessionEvent(p, "logout_all")
		}
		w.Header().Set("Set-Cookie", m.cookie("", 0))
		w.WriteHeader(http.StatusNoContent)
	})
}
