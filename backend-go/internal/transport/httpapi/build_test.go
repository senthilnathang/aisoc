package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBuildCatalogContracts(t *testing.T) {
	mux := http.NewServeMux()
	registerBuild(mux, nil)
	for _, q := range []string{"?kind=secret", "?limit=0", "?limit=101", "?offset=4294967296", "?tenant_id=foreign", "?search=a&search=b", "?search=%00"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/build/catalog"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
}
