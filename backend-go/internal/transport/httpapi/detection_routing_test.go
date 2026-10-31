package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoutingRejectsMalformedContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerDetectionRouting(mux, nil)
	for _, x := range []struct{ method, path, body string }{{"GET", "/api/v1/detection-routing?tenant=x", ""}, {"PUT", "/api/v1/detection-routing", `{"actor":"forged"}`}, {"POST", "/api/v1/detection-routing/preview", `{"config":{"policies":[{"id":"x","name":"X","status":"enabled","outcome":"Quarantine"}],"lists":[]}}`}, {"POST", "/api/v1/detection-routing/preview", `{} {}`}} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(x.method, x.path, strings.NewReader(x.body)))
		if w.Code != 400 {
			t.Fatalf("%s %d", x.path, w.Code)
		}
	}
}
