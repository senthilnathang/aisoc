package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecommendationContractsRejectInvalidInputs(t *testing.T) {
	mux := http.NewServeMux()
	registerRuleRecommendations(mux, nil)
	for _, entry := range []struct{ method, path, body string }{{"GET", "/api/v1/detection-rules/x/recommendations?days=91", ""}, {"GET", "/api/v1/detection-rules/x/recommendations?tenant=other", ""}, {"POST", "/api/v1/detection-rules/x/recommendations/generate", `{"unknown":true}`}, {"PUT", "/api/v1/detection-rules/x/alert-labels/a", `{"label":"false_positive","reviewer":"forged"}`}, {"POST", "/api/v1/detection-rules/x/recommendations/r/apply", `{"approved":true}`}} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(entry.method, entry.path, strings.NewReader(entry.body)))
		if w.Code != 400 {
			t.Fatalf("%s: %d", entry.path, w.Code)
		}
	}
}
