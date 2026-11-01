package httpapi

import (
	"aisoc/backend/internal/modules/skills"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSkillsWorkspaceContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerSkillsWorkspace(mux, skills.Store{})
	for _, q := range []string{"?origin=bad", "?limit=0", "?offset=4294967296", "?search=a&search=b", "?tenant_id=x", "?state=active"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/skills/library"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"expected_version":0}`, `{"expected_version":1,"tenant_id":"other"}`, `{"expected_version":1,"publish":null}`, `{"expected_version":true}`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("PATCH", "/api/v1/skills/x/workspace", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"expected_version":1,"enabled":null}`, `{"expected_version":1,"enabled":"false"}`, `{"expected_version":1,"enabled":true,"origin":"user"}`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("PUT", "/api/v1/skills/x/enabled", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
}
