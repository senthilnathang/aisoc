package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIntelHuntStrictContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerIntelHuntFlow(mux, nil)
	for _, v := range [][2]string{{"/threat-intel/import/preview", `{"tenant_id":"foreign"}`}, {"/threat-intel/import", `{}`}, {"/hunts/h/promote", `{"run_id":"r","kind":"case","record_id":"c","comment":"reviewed evidence"}`}, {"/hunts/h/promote", `{"tenant_id":"foreign","confirm":true}`}} {
		req := httptest.NewRequest("POST", "/api/v1"+v[0], strings.NewReader(v[1]))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatal(v, w.Code, w.Body.String())
		}
	}
}
