package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
)

var searchIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

type ArielSearch struct {
	ID     string `json:"search_id"`
	Status string `json:"status"`
}

// StartSavedSearch accepts only a configured saved query. Operators must scope
// that query to the connector's domain, time window and evidence budget. LLMs
// cannot supply AQL. A timed-out POST is ambiguous and is never retried here.
func (q *QRadar) StartSavedSearch(ctx context.Context, savedID int64) (ArielSearch, error) {
	var result ArielSearch
	if q.product != "qradar-siem" || savedID < 1 || !q.savedSearches[savedID] {
		return result, ErrContract
	}
	u := *q.base
	u.Path = "/api/ariel/searches"
	u.RawQuery = url.Values{"saved_search_id": {strconv.FormatInt(savedID, 10)}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), nil)
	if err != nil {
		return result, ErrContract
	}
	req.Header.Set("SEC", q.credential)
	req.Header.Set("Version", q.version)
	req.Header.Set("Accept", "application/json")
	res, err := q.client.Do(req)
	if err != nil {
		return result, fmt.Errorf("Ariel submission outcome unknown; reconcile before retry")
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 || res.StatusCode != 201 || json.Unmarshal(raw, &result) != nil || !searchIDPattern.MatchString(result.ID) {
		return ArielSearch{}, ErrContract
	}
	return result, nil
}

func (q *QRadar) SearchStatus(ctx context.Context, id string) (ArielSearch, error) {
	var result ArielSearch
	if q.product != "qradar-siem" || !searchIDPattern.MatchString(id) {
		return result, ErrContract
	}
	if err := q.read(ctx, "/api/ariel/searches/"+id, nil, &result); err != nil {
		return result, err
	}
	if result.ID != id {
		return ArielSearch{}, ErrContract
	}
	switch result.Status {
	case "WAIT", "EXECUTE", "SORTING", "COMPLETED", "CANCELED", "ERROR":
		return result, nil
	}
	return ArielSearch{}, ErrContract
}

// SearchResults returns a bounded first page. A full page explicitly requires
// query refinement; it must never be treated as complete evidence. The saved
// query must project domainid so cross-domain evidence can be rejected.
func (q *QRadar) SearchResults(ctx context.Context, id string) ([]json.RawMessage, bool, error) {
	status, err := q.SearchStatus(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if status.Status != "COMPLETED" {
		return nil, false, fmt.Errorf("Ariel search is not complete")
	}
	var result struct {
		Events []json.RawMessage `json:"events"`
	}
	if err = q.read(ctx, "/api/ariel/searches/"+id+"/results", nil, &result); err != nil {
		return nil, false, err
	}
	if result.Events == nil || len(result.Events) > 100 {
		return nil, false, ErrContract
	}
	for _, raw := range result.Events {
		var event struct {
			Domain *int64 `json:"domainid"`
		}
		if json.Unmarshal(raw, &event) != nil || event.Domain == nil || *event.Domain != q.domain {
			return nil, false, ErrContract
		}
	}
	return result.Events, len(result.Events) == 100, nil
}
