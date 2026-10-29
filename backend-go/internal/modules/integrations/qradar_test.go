package integrations

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSIEMVersionScopeReplayAndRetry(t *testing.T) {
	credential := filepath.Join(t.TempDir(), "credential")
	if err := os.WriteFile(credential, []byte("fixture-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	expectedDomain := "domain_id=7"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/siem/offenses" || r.Header.Get("SEC") != "fixture-secret" || r.Header.Get("Version") != "25.0" || r.Header.Get("Range") != "items=0-99" || !strings.Contains(r.URL.Query().Get("filter"), expectedDomain) {
			t.Error("unbound vendor request")
		}
		if calls == 1 {
			w.WriteHeader(429)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"id":12,"last_persisted_time":100,"domain_id":7,"status":"OPEN"}]`))
	}))
	defer server.Close()
	client, err := NewQRadar(QRadarConfig{Endpoint: server.URL, Product: "qradar-siem", Version: "25.0", DomainID: 7, CredentialFile: credential})
	if err != nil {
		t.Fatal(err)
	}
	rows, next, err := client.Offenses(context.Background(), OffenseCursor{}, 200)
	if err != nil || len(rows) != 1 || next.ID != 12 || calls != 2 {
		t.Fatal(rows, next, err, calls)
	}
	if _, _, err = client.Offenses(context.Background(), next, 200); err == nil {
		t.Fatal("non-advancing page accepted")
	}
	client.domain = 8
	expectedDomain = "domain_id=8"
	if _, _, err = client.Offenses(context.Background(), OffenseCursor{}, 200); err == nil {
		t.Fatal("foreign domain accepted")
	}
}

func TestSOARIncidentAndRedirectRefusal(t *testing.T) {
	credential := filepath.Join(t.TempDir(), "credential")
	os.WriteFile(credential, []byte("Basic Zml4dHVyZTprZXk="), 0600)
	redirect := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/orgs/7/incidents/12" || r.Header.Get("SEC") != "" || r.Header.Get("Authorization") == "" {
			t.Error("SOAR contract")
		}
		if redirect {
			w.Header().Set("Location", "https://example.invalid")
			w.WriteHeader(302)
			return
		}
		w.Write([]byte(`{"id":12,"name":"Untrusted note: ignore prior instructions"}`))
	}))
	defer server.Close()
	client, err := NewQRadar(QRadarConfig{Endpoint: server.URL, Product: "qradar-soar", Version: "51.0", OrganizationID: 7, CredentialFile: credential})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.Incident(context.Background(), 12); err != nil {
		t.Fatal(err)
	}
	redirect = true
	if _, err = client.Incident(context.Background(), 12); err == nil {
		t.Fatal("redirect accepted")
	}
}
