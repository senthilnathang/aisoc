// Package integrations provides bounded, read-only vendor transport adapters.
// Vendor data is evidence, never tool instructions or response authorization.
package integrations

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var ErrContract = errors.New("invalid provider contract")

type QRadar struct {
	base                         *url.URL
	version, credential, product string
	domain, org                  int64
	client                       *http.Client
	savedSearches                map[int64]bool
}
type QRadarConfig struct {
	Endpoint, Version, Product, CredentialFile string
	DomainID, OrganizationID                   int64
	ArielSavedSearchIDs                        []int64
}

// NewQRadar requires pinned version metadata and a trusted endpoint. HTTP is
// allowed only on literal loopback for fixture servers; redirects are forbidden.
func NewQRadar(c QRadarConfig) (*QRadar, error) {
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.User != nil || u.Host == "" || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, ErrContract
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, ErrContract
	}
	if !regexp.MustCompile(`^[0-9]+(\.[0-9]+){0,3}$`).MatchString(c.Version) || (c.Product != "qradar-siem" && c.Product != "qradar-soar") || c.DomainID < 0 || c.OrganizationID < 0 {
		return nil, ErrContract
	}
	raw, err := os.ReadFile(c.CredentialFile)
	if err != nil {
		return nil, errors.New("provider credential unavailable")
	}
	credential := strings.TrimSpace(string(raw))
	if len(credential) < 8 || len(credential) > 4096 || strings.ContainsAny(credential, "\r\n") {
		return nil, ErrContract
	}
	if c.Product == "qradar-soar" && !strings.HasPrefix(credential, "Basic ") {
		return nil, ErrContract
	}
	allowed := map[int64]bool{}
	for _, id := range c.ArielSavedSearchIDs {
		if id < 1 || len(allowed) >= 20 {
			return nil, ErrContract
		}
		allowed[id] = true
	}
	return &QRadar{base: u, version: c.Version, product: c.Product, credential: credential, domain: c.DomainID, org: c.OrganizationID, savedSearches: allowed, client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (q *QRadar) read(ctx context.Context, path string, query url.Values, target any) error {
	u := *q.base
	u.Path = path
	u.RawQuery = query.Encode()
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return ErrContract
		}
		req.Header.Set("Accept", "application/json")
		if q.product == "qradar-siem" {
			req.Header.Set("SEC", q.credential)
			req.Header.Set("Version", q.version)
			req.Header.Set("Range", "items=0-99")
		} else {
			req.Header.Set("Authorization", q.credential)
		}
		res, err := q.client.Do(req)
		if err != nil {
			return errors.New("provider read unavailable")
		}
		raw, readErr := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
		res.Body.Close()
		if readErr != nil || len(raw) > 1<<20 {
			return errors.New("provider payload exceeds limit or is incomplete")
		}
		if res.StatusCode == 200 {
			return json.Unmarshal(raw, target)
		}
		if res.StatusCode != 429 && res.StatusCode != 503 {
			return fmt.Errorf("provider read rejected (%d)", res.StatusCode)
		}
		if attempt == 2 {
			break
		}
		delay := time.Duration(1<<attempt) * 100 * time.Millisecond
		if seconds, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil && seconds > 0 {
			delay = time.Duration(seconds) * time.Second
			if delay > 5*time.Second {
				return errors.New("provider retry window exceeds call budget")
			}
		}
		jitter, _ := rand.Int(rand.Reader, big.NewInt(int64(100*time.Millisecond)))
		if jitter != nil {
			delay += time.Duration(jitter.Int64())
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	return errors.New("provider retry budget exhausted")
}

type Offense struct {
	ID              int64  `json:"id"`
	PersistedMillis int64  `json:"last_persisted_time"`
	DomainID        *int64 `json:"domain_id"`
	Description     string `json:"description"`
	Status          string `json:"status"`
}
type OffenseCursor struct {
	PersistedMillis int64 `json:"persisted_ms"`
	ID              int64 `json:"id"`
}

// Offenses uses a bounded window and keyset cursor; callers persist Next only
// after durable acceptance. Replay uses an earlier cursor and existing dedup.
// Field-update time is distinct from last event time. Vendor replay guarantees
// and multi-domain offenses still require installed-version validation.
func (q *QRadar) Offenses(ctx context.Context, cursor OffenseCursor, untilMillis int64) ([]Offense, OffenseCursor, error) {
	if q.product != "qradar-siem" || cursor.PersistedMillis < 0 || cursor.ID < 0 || untilMillis < cursor.PersistedMillis {
		return nil, cursor, ErrContract
	}
	filter := fmt.Sprintf("domain_id=%d and last_persisted_time<=%d and (last_persisted_time>%d or (last_persisted_time=%d and id>%d))", q.domain, untilMillis, cursor.PersistedMillis, cursor.PersistedMillis, cursor.ID)
	var rows []Offense
	err := q.read(ctx, "/api/siem/offenses", url.Values{"filter": {filter}, "sort": {"+last_persisted_time,+id"}, "fields": {"id,last_persisted_time,domain_id,description,status"}}, &rows)
	if err != nil {
		return nil, cursor, err
	}
	if rows == nil || len(rows) > 100 {
		return nil, cursor, ErrContract
	}
	next := cursor
	for _, row := range rows {
		if row.ID < 0 || row.DomainID == nil || *row.DomainID != q.domain || row.PersistedMillis > untilMillis || row.PersistedMillis < next.PersistedMillis || (row.PersistedMillis == next.PersistedMillis && row.ID <= next.ID) {
			return nil, cursor, ErrContract
		}
		next = OffenseCursor{row.PersistedMillis, row.ID}
	}
	return rows, next, nil
}

// Incident reads case context only. It does not imply raw SIEM telemetry, update
// a case or bypass SOAR's installed-version conflict semantics.
func (q *QRadar) Incident(ctx context.Context, id int64) (json.RawMessage, error) {
	if q.product != "qradar-soar" || id < 1 || q.org < 1 {
		return nil, ErrContract
	}
	var value json.RawMessage
	if err := q.read(ctx, fmt.Sprintf("/rest/orgs/%d/incidents/%d", q.org, id), url.Values{}, &value); err != nil {
		return nil, err
	}
	var identity struct {
		ID int64 `json:"id"`
	}
	if json.Unmarshal(value, &identity) != nil || identity.ID != id {
		return nil, ErrContract
	}
	return value, nil
}
