package config

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Operator struct {
	ID        string `json:"id"`
	TenantID  string `json:"tenant_id"`
	TokenHash string `json:"token_hash"`
}
type Auth struct {
	Mode, DefaultTenant string
	Operators           []Operator
	Origins             []string
	SecureCookies       bool
	SessionTTL          time.Duration
	StreamOperations    []StreamScope
}

func loadAuth() (Auth, error) {
	a := Auth{Mode: value("AISOC_GO_AUTH_MODE", "local"), DefaultTenant: value("AISOC_GO_DEFAULT_TENANT", "demo"), Origins: strings.Split(value("AISOC_GO_APP_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"), ","), SecureCookies: os.Getenv("AISOC_GO_ENV") == "production", SessionTTL: 8 * time.Hour}
	if path := os.Getenv("AISOC_GO_OPERATORS_FILE"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return a, errors.New("cannot read operator credential file")
		}
		if err = json.Unmarshal(data, &a.Operators); err != nil || a.Operators == nil {
			return a, errors.New("invalid operator credential configuration")
		}
	}
	if path := os.Getenv("AISOC_GO_STREAM_OPERATIONS_FILE"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return a, errors.New("cannot read stream operations grants")
		}
		if err = json.Unmarshal(data, &a.StreamOperations); err != nil || a.StreamOperations == nil {
			return a, errors.New("invalid stream operations grants")
		}
	}
	if raw := os.Getenv("AISOC_GO_SECURE_COOKIES"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return a, errors.New("invalid secure-cookie setting")
		}
		a.SecureCookies = value
	}
	if raw := os.Getenv("AISOC_GO_SESSION_TTL_MS"); raw != "" {
		ms, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || ms < 1000 || ms > 86400000 {
			return a, errors.New("session lifetime must be between one second and 24 hours")
		}
		a.SessionTTL = time.Duration(ms) * time.Millisecond
	}
	return a, a.Validate(os.Getenv("AISOC_GO_ENV") == "production")
}
func (a Auth) Validate(production bool) error {
	for _, scope := range a.StreamOperations {
		if production && scope.AllowMockImport {
			return errors.New("mock stream import is disabled in production")
		}
	}
	if err := validateStreamScopes(a); err != nil {
		return err
	}
	if a.Mode != "local" && a.Mode != "token" {
		return errors.New("auth mode must be local or token")
	}
	if strings.TrimSpace(a.DefaultTenant) == "" || len(a.DefaultTenant) > 120 {
		return errors.New("invalid default tenant")
	}
	if a.SessionTTL < time.Second || a.SessionTTL > 24*time.Hour {
		return errors.New("invalid session lifetime")
	}
	if len(a.Operators) > 100 || (a.Mode == "token" && len(a.Operators) == 0) {
		return errors.New("token mode requires 1..100 operator credentials")
	}
	ids, hashes := map[string]bool{}, map[string]bool{}
	pattern := regexp.MustCompile(`^[a-f0-9]{64}$`)
	for _, op := range a.Operators {
		if strings.TrimSpace(op.ID) == "" || strings.TrimSpace(op.TenantID) == "" || len(op.TenantID) > 120 || !pattern.MatchString(op.TokenHash) || ids[op.ID] || hashes[op.TokenHash] {
			return errors.New("invalid or duplicate operator credentials")
		}
		ids[op.ID] = true
		hashes[op.TokenHash] = true
	}
	for _, origin := range a.Origins {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || origin != u.Scheme+"://"+u.Host {
			return errors.New("origins must be exact HTTP(S) origins")
		}
		if production && u.Scheme != "https" {
			return errors.New("production requires HTTPS origins")
		}
	}
	if production && (a.Mode != "token" || !a.SecureCookies) {
		return errors.New("production requires token auth and secure cookies")
	}
	return nil
}
