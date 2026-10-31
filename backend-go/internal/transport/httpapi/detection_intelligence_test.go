package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIntelligenceRejectsInvalidQueryBeforeDatabase(t *testing.T) {
	mux := http.NewServeMux()
	registerIntelligence(mux, nil)
	for _, query := range []string{"days=91", "days=0", "search=a&search=b", "unknown=x", "severity=invalid", "rule_id=a&rule_id=b"} {
		t.Run(query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, httptest.NewRequest("GET", "/api/v1/detection-intelligence?"+query, nil))
			if recorder.Code != 400 {
				t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
