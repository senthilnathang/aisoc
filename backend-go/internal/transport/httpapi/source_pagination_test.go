package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSourcePaginationValidation(t *testing.T) {
	mux := http.NewServeMux()
	registerSources(mux, nil)
	for _, q := range []string{"limit=0", "limit=501", "offset=-1", "offset=1000001", "limit=1&limit=2", "tenant_id=foreign"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/api-sources?"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
}
