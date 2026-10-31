package httpapi

import (
	"aisoc/backend/internal/modules/hunts"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHuntWorkspaceRejectsMalformedBodies(t *testing.T) {
	mux := http.NewServeMux()
	registerHuntWorkspace(mux, hunts.Store{})
	for _, v := range [][2]string{{"search", `{}`}, {"search", `{"id":"../invalid","expected_updated_at":"x"}`}, {"notes", `{"id":"x","body":""}`}, {"notes", `{"id":"../bad","body":"note"}`}} {
		req := httptest.NewRequest("POST", "/api/v1/hunts/x/"+v[0], strings.NewReader(v[1]))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatal(w.Code, v)
		}
	}
}
