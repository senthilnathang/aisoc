package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInsightContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerInsights(mux, nil)
	for _, q := range []string{"?tab=bad", "?limit=101", "?offset=4294967296", "?tenant_id=other", "?search=a&search=b", "?search=%00"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/enterprise-insights"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"id":"EI-12345678","artifact":"a","kind":"user","content":"text","tenant_id":"other"}`, `{"id":"EI-12345678","artifact":"a","kind":"user","content":"text","valid_until":"bad"}`, `{"id":"EI-12345678","artifact":"a","kind":"user","content":"text","from_prevalence":"true"}`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/v1/enterprise-insights", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		mux.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/v1/enterprise-insights/x/archive", strings.NewReader(`{"expected_version":null}`))
	r.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}
