package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArielSavedQueryScopeAndStatus(t *testing.T) {
	credential := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(credential, []byte("fixture-token"), 0600); err != nil {
		t.Fatal(err)
	}
	status := "EXECUTE"
	domain := 7
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("SEC") != "fixture-token" || r.Header.Get("Version") != "25.0" {
			t.Error("missing pinned authentication")
		}
		switch r.URL.Path {
		case "/api/ariel/searches":
			if r.Method != "POST" || r.URL.Query().Get("saved_search_id") != "42" || r.URL.Query().Has("query_expression") {
				t.Error("unapproved query")
			}
			w.WriteHeader(201)
			w.Write([]byte(`{"search_id":"search-1","status":"WAIT"}`))
		case "/api/ariel/searches/search-1":
			json.NewEncoder(w).Encode(ArielSearch{"search-1", status})
		case "/api/ariel/searches/search-1/results":
			if r.Header.Get("Range") != "items=0-99" {
				t.Error("unbounded results")
			}
			json.NewEncoder(w).Encode(map[string]any{"events": []any{map[string]any{"domainid": domain, "username": "fixture"}}})
		default:
			t.Error("unexpected path")
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	q, err := NewQRadar(QRadarConfig{Endpoint: server.URL, Product: "qradar-siem", Version: "25.0", DomainID: 7, CredentialFile: credential, ArielSavedSearchIDs: []int64{42}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.StartSavedSearch(context.Background(), 99); err == nil || calls != 0 {
		t.Fatal("query allowlist bypass")
	}
	search, err := q.StartSavedSearch(context.Background(), 42)
	if err != nil || search.ID != "search-1" {
		t.Fatal(search, err)
	}
	if _, _, err = q.SearchResults(context.Background(), search.ID); err == nil {
		t.Fatal("unfinished evidence accepted")
	}
	status = "COMPLETED"
	events, truncated, err := q.SearchResults(context.Background(), search.ID)
	if err != nil || len(events) != 1 || truncated {
		t.Fatal(events, truncated, err)
	}
	domain = 8
	if _, _, err = q.SearchResults(context.Background(), search.ID); err == nil {
		t.Fatal("foreign domain accepted")
	}
}

func TestSentinelContinuationCannotExfiltrateToken(t *testing.T) {
	credential := filepath.Join(t.TempDir(), "token")
	os.WriteFile(credential, []byte("fixture-token"), 0600)
	calls := 0
	foreign := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer fixture-token" || r.URL.Query().Get("api-version") != "2025-09-01" {
			t.Error("request binding")
		}
		path := r.URL.Path
		if foreign {
			path = strings.Replace(path, "/workspaces/demo/", "/workspaces/other/", 1)
		}
		json.NewEncoder(w).Encode(map[string]any{"value": []any{map[string]any{"id": path + "/incident-1", "name": "incident-1"}}})
	}))
	defer server.Close()
	s, err := NewSentinel(SentinelConfig{Endpoint: server.URL, APIVersion: "2025-09-01", SubscriptionID: "00000000-0000-0000-0000-000000000001", ResourceGroup: "fixture", Workspace: "demo", CredentialFile: credential})
	if err != nil {
		t.Fatal(err)
	}
	if page, err := s.Incidents(context.Background(), ""); err != nil || len(page.Value) != 1 {
		t.Fatal(page, err)
	}
	for _, next := range []string{"https://evil.invalid" + s.path + "?api-version=" + s.version, server.URL + strings.Replace(s.path, "/demo/", "/other/", 1) + "?api-version=" + s.version, server.URL + s.path + "?api-version=bad"} {
		if _, err = s.Incidents(context.Background(), next); err == nil {
			t.Fatal("unsafe continuation accepted")
		}
	}
	if calls != 1 {
		t.Fatal("sent credential to rejected continuation")
	}
	foreign = true
	if _, err = s.Incidents(context.Background(), ""); err == nil {
		t.Fatal("foreign workspace accepted")
	}
}
