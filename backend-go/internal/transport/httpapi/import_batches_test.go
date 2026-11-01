package httpapi

import (
	"aisoc/backend/internal/modules/localintegrations"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBatchRequestsFailClosedBeforeStorage(t *testing.T) {
	mux := http.NewServeMux()
	registerImportBatches(mux, localintegrations.Store{}, nil)
	for _, tt := range []struct {
		body   string
		status int
	}{{`{"schema_version":"1","unknown":true}`, 400}, {`{"schema_version":"1","scope_id":"ungranted","cases":[]}`, 403}, {strings.Repeat("x", (1<<20)+1), 413}} {
		req := httptest.NewRequest("POST", "/api/v1/build/import-batches/preview", strings.NewReader(tt.body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != tt.status {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
