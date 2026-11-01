package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestApprovalInboxRejectsInvalidFilters(t *testing.T) {
	mux := http.NewServeMux()
	registerApprovalInbox(mux, nil)
	for _, q := range []string{"?kind=secret", "?stage=done", "?limit=0", "?limit=51", "?offset=-1", "?offset=4294967296", "?tenant_id=foreign", "?search=a&search=b", "?search=%00", "?limit=NaN"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/approvals"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code, w.Body.String())
		}
	}
}
