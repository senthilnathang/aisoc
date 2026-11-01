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
	ID        string   `json:"id"`
	TenantID  string   `json:"tenant_id"`
	TokenHash string   `json:"token_hash"`
	Roles     []string `json:"roles"`
}
type Auth struct {
	OIDC *OIDC

	Mode, DefaultTenant string
	Operators           []Operator
	Origins             []string
	SecureCookies       bool
	SessionTTL          time.Duration
	StreamOperations    []StreamScope
	BuildMaxProfiles    int
	BuildMaxBatches     int
}

func loadAuth() (Auth, error) {
	a := Auth{Mode: value("AISOC_GO_AUTH_MODE", "local"), DefaultTenant: value("AISOC_GO_DEFAULT_TENANT", "demo"), Origins: strings.Split(value("AISOC_GO_APP_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"), ","), SecureCookies: os.Getenv("AISOC_GO_ENV") == "production", SessionTTL: 8 * time.Hour}
	for key, target := range map[string]*int{"AISOC_BUILD_MAX_RETAINED_PROFILES": &a.BuildMaxProfiles, "AISOC_BUILD_MAX_RETAINED_BATCHES": &a.BuildMaxBatches} {
		n, err := strconv.Atoi(value(key, "20"))
		if err != nil || n < 1 || n > 200 {
			return a, errors.New(key + " must be 1..200")
		}
		*target = n
	}
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
	if path := os.Getenv("AISOC_GO_OIDC_FILE"); path != "" {
		a.OIDC = &OIDC{}
		if err := ReadPrivateJSON(path, a.OIDC); err != nil {
			return a, err
		}
		if a.OIDC.ClientSecretFile != "" {
			raw, err := os.ReadFile(a.OIDC.ClientSecretFile)
			if err != nil || len(raw) > 4096 {
				return a, errors.New("cannot read bounded OIDC client secret")
			}
			a.OIDC.ClientSecret = strings.TrimSpace(string(raw))
		}
		if a.Mode == "oidc" {
			mappings, err := a.OIDC.Mappings()
			if err != nil {
				return a, err
			}
			a.Operators = nil
			for _, m := range mappings {
				a.Operators = append(a.Operators, Operator{ID: m.OperatorID, TenantID: m.TenantID, Roles: m.Roles})
			}
		}
	}
	return a, a.Validate(os.Getenv("AISOC_GO_ENV") == "production")
}
func (a Auth) Validate(production bool) error {
	if a.BuildMaxProfiles < 0 || a.BuildMaxProfiles > 200 || a.BuildMaxBatches < 0 || a.BuildMaxBatches > 200 {
		return errors.New("local retention limits must be 1..200, or omitted for defaults")
	}
	for _, scope := range a.StreamOperations {
		if production && scope.AllowSandboxResponse {
			return errors.New("sandbox responses are disabled in production")
		}
		if production && scope.AllowMockImport {
			return errors.New("mock stream import is disabled in production")
		}
	}
	if err := validateStreamScopes(a); err != nil {
		return err
	}
	if a.Mode != "local" && a.Mode != "token" && a.Mode != "oidc" {
		return errors.New("auth mode must be local, token or oidc")
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
		if strings.TrimSpace(op.ID) == "" || op.ID == "local-development" || strings.TrimSpace(op.TenantID) == "" || len(op.TenantID) > 120 || (a.Mode != "oidc" && (!pattern.MatchString(op.TokenHash) || hashes[op.TokenHash])) || ids[op.ID] {
			return errors.New("invalid or duplicate operator credentials")
		}
		seenRoles := map[string]bool{}
		for _, role := range op.Roles {
			if (role != "proposer" && role != "approver" && role != "executor") || seenRoles[role] {
				return errors.New("invalid or duplicate operator role")
			}
			seenRoles[role] = true
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
	if a.Mode == "oidc" {
		if a.OIDC == nil {
			return errors.New("OIDC configuration is required")
		}
		if err := a.OIDC.Validate(a.Origins); err != nil {
			return err
		}
	}
	if production && (a.Mode != "token" || !a.SecureCookies) {
		return errors.New("production requires token auth and secure cookies")
	}
	return nil
}
