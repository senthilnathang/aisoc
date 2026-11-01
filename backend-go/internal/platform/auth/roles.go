package auth

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// Roles come exclusively from trusted operator configuration. A role is not
// authority for another tenant and never overrides a resource's approval checks.
func (m *Manager) roles(p Principal) []string {
	for _, op := range m.config.Operators {
		if op.ID == p.ID && op.TenantID == p.Tenant {
			return append([]string{}, op.Roles...)
		}
	}
	if m.config.Mode == "local" && p.ID == "local-development" {
		return []string{"proposer"}
	}
	return []string{}
}
func (m *Manager) permit(w http.ResponseWriter, r *http.Request, p Principal) bool {
	role, err := requiredRole(r)
	if err != nil {
		var oversized *http.MaxBytesError
		if errors.As(err, &oversized) {
			deny(w, 413, "PAYLOAD_TOO_LARGE", "Request exceeds 1 MiB.")
		} else {
			deny(w, 400, "VALIDATION_ERROR", "Invalid approval operation body.")
		}
		return false
	}
	if role == "" {
		return true
	}
	for _, granted := range m.roles(p) {
		if granted == role {
			return true
		}
	}
	deny(w, 403, "ROLE_REQUIRED", "This operation requires the "+role+" role on an authenticated operator.")
	return false
}

// Restrict all aliases, including legacy publication/material routes. Body bytes
// are restored unchanged; handlers retain strict validation and size limits.
func requiredRole(r *http.Request) (string, error) {
	if r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS" {
		return "", nil
	}
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/v1/build/retention/") {
		return "proposer", nil
	}
	guidance := strings.HasPrefix(p, "/api/v1/skills") || strings.HasPrefix(p, "/api/v1/enterprise-insights")
	learning := strings.HasPrefix(p, "/api/v1/investigations/") && strings.HasSuffix(p, "/learning")
	sandbox := strings.HasSuffix(p, "/sandbox-responses") || strings.HasSuffix(p, "/sandbox-session")
	runbook := strings.HasPrefix(p, "/api/v1/investigations/") && strings.Contains(p, "/runbooks")
	respond := strings.HasPrefix(p, "/api/v1/response-plans") || strings.HasPrefix(p, "/api/v1/remediations")
	if !guidance && !learning && !sandbox && !respond && !runbook {
		return "", nil
	}
	if respond {
		if strings.HasSuffix(p, "/execute") {
			return "executor", nil
		}
		if strings.HasSuffix(p, "/policy") {
			return "approver", nil
		}
		return "proposer", nil
	}
	if runbook {
		if r.Method == "PATCH" {
			return "approver", nil
		}
		return "proposer", nil
	}
	if guidance && !strings.HasSuffix(p, "/lifecycle") && !strings.HasSuffix(p, "/workspace") {
		if strings.HasSuffix(p, "/publish") || strings.HasSuffix(p, "/toggle") || strings.HasSuffix(p, "/enabled") {
			return "approver", nil
		}
		return "proposer", nil
	}
	var b map[string]any
	if r.Body != nil {
		raw, e := io.ReadAll(io.LimitReader(r.Body, 1048577))
		if e != nil {
			return "", e
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		if len(raw) > 1048576 {
			return "", &http.MaxBytesError{Limit: 1048576}
		}
		if len(raw) > 0 {
			if e = json.Unmarshal(raw, &b); e != nil {
				return "", e
			}
		}
	}
	if runbook {
		if r.Method == "PATCH" {
			return "approver", nil
		}
		return "proposer", nil
	}
	op, _ := b["operation"].(string)
	if sandbox {
		switch op {
		case "approve", "policy":
			return "approver", nil
		case "execute", "dry_run":
			return "executor", nil
		default:
			return "proposer", nil
		}
	}
	if learning {
		if op == "approve" {
			return "approver", nil
		}
		return "proposer", nil
	}
	if strings.HasSuffix(p, "/execute") {
		return "executor", nil
	}
	if strings.HasSuffix(p, "/publish") || strings.HasSuffix(p, "/toggle") || strings.HasSuffix(p, "/enabled") || strings.HasSuffix(p, "/policy") || b["publish"] == true {
		return "approver", nil
	}
	if strings.HasSuffix(p, "/lifecycle") {
		switch op {
		case "approve", "reapprove", "publish-staged":
			return "approver", nil
		}
	}
	return "proposer", nil
}
func (m *Manager) sessionInfo(s session) map[string]any {
	out := sessionBody(s)
	out["roles"] = m.roles(s.Principal)
	return out
}
