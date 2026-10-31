package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkspaceRejectsInvalidContract(t *testing.T) {
	mux := http.NewServeMux()
	registerInvestigationWorkspace(mux, nil)
	for _, v := range []struct{ method, path, body string }{{"GET", "/api/v1/investigations/x/workspace?tenant=x", ""}, {"POST", "/api/v1/investigations/x/evidence-chat", `{"actor":"forged","question":"x"}`}, {"POST", "/api/v1/investigations/x/evidence-chat", `{"id":"x","question":"x"}`}, {"POST", "/api/v1/investigations/x/evidence-chat", `{} {}`}} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(v.method, v.path, strings.NewReader(v.body)))
		if w.Code != 400 {
			t.Fatal(v.path, w.Code)
		}
	}
}
