package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLifecycleRejectsUnconfirmedAndForgedInput(t *testing.T) {
	mux := http.NewServeMux()
	registerLearningLifecycle(mux, nil)
	for _, body := range []string{`{}`, `{"operation":"archive","expected_version":1,"confirm":false,"rationale":"Reviewed fixture"}`, `{"tenant_id":"other"}`, `{"operation":"publish-staged","expected_version":null,"confirm":true,"rationale":"Reviewed fixture"}`} {
		r := httptest.NewRequest("POST", "/api/v1/skills/fixture/lifecycle", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
}
