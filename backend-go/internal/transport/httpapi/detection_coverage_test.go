package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCoverageRejectsMalformedBodyAndQuery(t *testing.T) {
	mux := http.NewServeMux()
	registerCoverage(mux, nil)
	for _, body := range []string{`{"unknown":true}`, `{"state":"gap"} {}`, `{"expected_version":1.5}`, `{"expected_version":9223372036854775808}`} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("PUT", "/api/v1/detection-coverage/T1059.001", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("got %d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/detection-coverage?tenant=other", nil))
	if w.Code != 400 {
		t.Fatal("query accepted")
	}
}
