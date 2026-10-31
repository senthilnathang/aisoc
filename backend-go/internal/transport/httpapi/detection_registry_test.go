package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegistryWindowQueryValidation(t *testing.T) {
	mux := http.NewServeMux()
	registerDetection(mux, nil)
	for _, path := range []string{
		"/api/v1/detection-registry?days=0", "/api/v1/detection-registry?days=91", "/api/v1/detection-registry?days=7&days=30",
		"/api/v1/detection-rules/x/metrics?days=91", "/api/v1/detection-rules/x/metrics?source=x", "/api/v1/detection-catalog?search=a&search=b", "/api/v1/detection-catalog?limit=1",
	} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			if w.Code != 400 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/detection-catalog?search=Kerberoasting", nil))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
}
