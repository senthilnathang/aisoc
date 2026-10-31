package httpapi
import (
 "aisoc/backend/internal/modules/response"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
)
func TestWorkflowPolicyRejectsUnsafeContracts(t *testing.T){
 mux:=http.NewServeMux();registerPlans(mux,response.Store{})
 for _,body:=range []string{
 `{}`,`{"expected_version":null,"enabled":false,"plan_version":1}`,`{"expected_version":0,"enabled":null,"plan_version":1}`,
 `{"expected_version":0,"enabled":true,"plan_version":1,"connector":"production","calling":"confirmation"}`,
 `{"expected_version":0,"enabled":true,"plan_version":1,"connector":"local-sandbox","calling":"automatic"}`,
 `{"expected_version":0,"enabled":true,"plan_version":1,"connector":"local-sandbox","calling":"confirmation","tenant_id":"forged"}`,
 `{"expected_version":-1,"enabled":false,"plan_version":1}`,
 } {
  req:=httptest.NewRequest("PATCH","/api/v1/response-plans/x/policy",strings.NewReader(body));req.Header.Set("Content-Type","application/json");w:=httptest.NewRecorder();mux.ServeHTTP(w,req);if w.Code!=400{t.Fatalf("got %d for %s",w.Code,body)}
 }
}
