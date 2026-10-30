package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

type SentinelConfig struct {
	Endpoint, APIVersion, SubscriptionID, ResourceGroup, Workspace, CredentialFile string
}
type Sentinel struct {
	base                          *url.URL
	path, version, credentialFile string
	client                        *http.Client
}
type SentinelPage struct {
	Value    []json.RawMessage `json:"value"`
	NextLink string            `json:"nextLink"`
}

// The credential file supplies an externally refreshed scoped ARM access token.
// No token refresh credentials enter the agent or the model worker.
func NewSentinel(c SentinelConfig) (*Sentinel, error) {
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.User != nil || u.Host == "" || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, ErrContract
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, ErrContract
	}
	segment := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$`)
	if !regexp.MustCompile(`^[0-9a-fA-F-]{36}$`).MatchString(c.SubscriptionID) || !segment.MatchString(c.ResourceGroup) || !segment.MatchString(c.Workspace) || !regexp.MustCompile(`^20[0-9]{2}-[0-9]{2}-[0-9]{2}(-preview)?$`).MatchString(c.APIVersion) || c.CredentialFile == "" {
		return nil, ErrContract
	}
	path := fmt.Sprintf("/subscriptions/%s/resourceGroups/%s/providers/Microsoft.OperationalInsights/workspaces/%s/providers/Microsoft.SecurityInsights/incidents", c.SubscriptionID, c.ResourceGroup, c.Workspace)
	return &Sentinel{u, path, c.APIVersion, c.CredentialFile, &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// Incidents returns one page. Continuations are constrained to the exact origin,
// workspace and API version before any credential is attached. Persist a cursor
// only after durable ingestion; a failure leaves the previous cursor unchanged.
func (s *Sentinel) Incidents(ctx context.Context, next string) (SentinelPage, error) {
	var page SentinelPage
	u := *s.base
	u.Path = s.path
	u.RawQuery = url.Values{"api-version": {s.version}, "$top": {"100"}}.Encode()
	if next != "" {
		n, err := url.Parse(next)
		if err != nil || n.User != nil || n.Scheme != u.Scheme || n.Host != u.Host || n.Path != s.path || n.Fragment != "" || n.Query().Get("api-version") != s.version || len(next) > 8192 {
			return page, ErrContract
		}
		u = *n
	}
	raw, err := os.ReadFile(s.credentialFile)
	if err != nil {
		return page, fmt.Errorf("Sentinel credential unavailable")
	}
	token := strings.TrimSpace(string(raw))
	if len(token) < 8 || len(token) > 16384 || strings.ContainsAny(token, "\r\n") {
		return page, ErrContract
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return page, ErrContract
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return page, fmt.Errorf("Sentinel read unavailable")
	}
	defer res.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 || res.StatusCode != 200 {
		return page, fmt.Errorf("Sentinel read rejected; retain cursor and retry within caller budget")
	}
	if json.Unmarshal(raw, &page) != nil || page.Value == nil || len(page.Value) > 100 || page.NextLink == next && next != "" {
		return SentinelPage{}, ErrContract
	}
	seen := map[string]bool{}
	for _, raw := range page.Value {
		var incident struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if json.Unmarshal(raw, &incident) != nil || !segmentID(incident.Name) || incident.ID != s.path+"/"+incident.Name || seen[incident.ID] {
			return SentinelPage{}, ErrContract
		}
		seen[incident.ID] = true
	}
	return page, nil
}
func segmentID(id string) bool { return regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`).MatchString(id) }
