package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLearningContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerLearning(mux, nil)
	for _, body := range []string{`{}`, `{"tenant_id":"other"}`, `{"confirm":"true"}`, `{"confirm":true,"create_skill":true,"guidance":"short"}`} {
		r := httptest.NewRequest("POST", "/api/v1/investigations/case/learning", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
