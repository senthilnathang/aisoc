package auth

import (
	"net/http/httptest"
	"testing"
)

func TestRetentionWritesRequireProposer(t *testing.T) {
	for _, path := range []string{"/api/v1/build/retention/policy", "/api/v1/build/retention/actions"} {
		role, e := requiredRole(httptest.NewRequest("POST", path, nil))
		if e != nil || role != "proposer" {
			t.Fatal(role, e)
		}
	}
}
