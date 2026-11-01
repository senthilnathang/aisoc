package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetentionQueryValidation(t *testing.T) {
	m := http.NewServeMux()
	registerRetention(m, nil)
	for _, path := range []string{"/api/v1/build/retention?tenant=foreign", "/api/v1/build/retention?kind=unknown", "/api/v1/build/retention?offset=-1", "/api/v1/build/retention?offset=wrong", "/api/v1/build/retention?kind=memory&kind=skill"} {
		w := httptest.NewRecorder()
		m.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 400 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
}
