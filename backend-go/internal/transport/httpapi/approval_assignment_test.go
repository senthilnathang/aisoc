package httpapi

import (
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssignmentContractsRejectSpoofedOrMalformedInputs(t *testing.T) {
	mux := http.NewServeMux()
	registerApprovalAssignments(mux, nil, auth.New(config.Auth{Mode: "local"}))
	for _, path := range []string{"/api/v1/approvals/assignment?kind=secret&id=test", "/api/v1/approvals/assignment?kind=skill&id=test&tenant_id=foreign", "/api/v1/approvals/assignment?kind=skill&kind=memory", "/api/v1/notifications?recipient_id=foreign", "/api/v1/notifications?limit=0", "/api/v1/notifications?limit=51"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/v1/approvals/assignment", strings.NewReader(`{"kind":"skill","id":"test","roles":["approver"]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatal("spoofed roles", w.Code)
	}
}
