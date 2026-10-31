package httpapi

import (
	"aisoc/backend/internal/modules/threatintel"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestThreatWorkspaceContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerThreatWorkspace(mux, threatintel.Store{})
	for _, path := range []string{"?limit=0", "?limit=101", "?offset=-1", "?offset=4294967296", "?relevant=maybe", "?search=a&search=b", "?tenant_id=x", "?status=malicious"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/threat-intel/registry"+path, nil))
		if w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"id":"../bad","indicator_id":"ioc"}`, `{"id":"x","indicator_id":""}`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/v1/threat-intel-reports/x/local-hunt", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
}
