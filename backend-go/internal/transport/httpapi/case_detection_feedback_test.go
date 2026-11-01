package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCaseDetectionFeedbackContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerCaseDetectionFeedback(mux, nil)
	for _, query := range []string{"limit=0", "offset=-1", "limit=101", "tenant=other", "offset=x", "limit=1&limit=2"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/investigations/case/detection-feedback?"+query, nil))
		if w.Code != 400 {
			t.Fatal(query, w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"tenant_id":"other"}`, `{"confirm":"true"}`, `{"confirm":true,"label":"false_positive","rationale":"Reviewed evidence"}`, `{"confirm":true,"expected_version":null}`, `{"confirm":true,"expected_version":-1}`} {
		r := httptest.NewRequest("PUT", "/api/v1/investigations/case/detection-feedback/alert", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
}
