package threatintel

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/threatintel/threatsql"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type ImportIOC struct {
	Type     string `json:"type"`
	Value    string `json:"value"`
	Severity string `json:"severity,omitempty"`
}
type IntelImport struct {
	SchemaVersion string      `json:"schema_version"`
	Source        string      `json:"source"`
	ExternalID    string      `json:"external_id"`
	Title         string      `json:"title"`
	Summary       string      `json:"summary"`
	Severity      string      `json:"severity"`
	PublishedAt   string      `json:"published_at"`
	Tags          []string    `json:"tags"`
	Indicators    []ImportIOC `json:"indicators"`
}
type ImportPreview struct {
	Document   IntelImport `json:"document"`
	Received   int         `json:"received"`
	Unique     int         `json:"unique"`
	Duplicates int         `json:"duplicates"`
	Hash       string      `json:"content_hash"`
	Mode       string      `json:"mode"`
}

var domainLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func validDomain(v string) bool {
	if len(v) > 253 || !strings.Contains(v, ".") {
		return false
	}
	for _, part := range strings.Split(v, ".") {
		if !domainLabel.MatchString(part) {
			return false
		}
	}
	return true
}
func normalizeIOC(kind, value string) (string, error) {
	v := strings.TrimSpace(value)
	bad := func() (string, error) {
		return "", fault.New(400, "INVALID_IOC", "Invalid "+kind+" indicator; use supported canonical, non-defanged values.")
	}
	if v == "" || len(v) > 200 || strings.IndexFunc(v, unicode.IsControl) >= 0 {
		return bad()
	}
	switch kind {
	case "ip":
		a, e := netip.ParseAddr(v)
		if e != nil || a.Zone() != "" {
			return bad()
		}
		return a.Unmap().String(), nil
	case "domain":
		v = strings.TrimSuffix(strings.ToLower(v), ".")
		if _, err := netip.ParseAddr(v); err == nil {
			return bad()
		}
		if !validDomain(v) {
			return bad()
		}
		return v, nil
	case "hash_sha256", "hash_md5":
		n := 64
		if kind == "hash_md5" {
			n = 32
		}
		if len(v) != n {
			return bad()
		}
		if _, e := hex.DecodeString(v); e != nil {
			return bad()
		}
		return strings.ToLower(v), nil
	case "url":
		u, e := url.Parse(v)
		if e != nil || u.User != nil || u.Opaque != "" || (strings.ToLower(u.Scheme) != "http" && strings.ToLower(u.Scheme) != "https") || u.Host == "" {
			return bad()
		}
		host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
		a, e := netip.ParseAddr(host)
		if e != nil && !validDomain(host) {
			return bad()
		}
		if e == nil {
			if a.Zone() != "" {
				return bad()
			}
			host = a.Unmap().String()
		}
		port := u.Port()
		if port != "" {
			p, e := strconv.Atoi(port)
			if e != nil || p < 1 || p > 65535 {
				return bad()
			}
		}
		u.Scheme = strings.ToLower(u.Scheme)
		if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
			port = ""
		}
		if port != "" {
			host = net.JoinHostPort(host, port)
		} else if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		u.Host = host
		u.Fragment = ""
		u.RawFragment = ""
		if u.Path == "" {
			u.Path = "/"
		}
		return u.String(), nil
	default:
		return bad()
	}
}
func importText(v string, max int) bool {
	return strings.TrimSpace(v) != "" && utf8.RuneCountInString(v) <= max && !strings.ContainsRune(v, 0)
}
func PreviewImport(in IntelImport) (ImportPreview, error) {
	rank := map[string]int{"low": 1, "medium": 2, "high": 3, "critical": 4}
	if in.SchemaVersion != "1" || !importText(in.Source, 100) || !importText(in.ExternalID, 128) || !importText(in.Title, 200) || utf8.RuneCountInString(in.Summary) > 8000 || strings.ContainsRune(in.Summary, 0) || rank[in.Severity] == 0 || len(in.Indicators) < 1 || len(in.Indicators) > 200 || len(in.Tags) > 20 {
		return ImportPreview{}, fault.New(400, "INVALID_IMPORT", "Use schema version 1, bounded report metadata and 1–200 supported indicators.")
	}
	at, e := time.Parse(time.RFC3339Nano, in.PublishedAt)
	if e != nil {
		return ImportPreview{}, fault.New(400, "INVALID_IMPORT", "published_at must include an RFC3339 timezone.")
	}
	in.PublishedAt = at.UTC().Format(time.RFC3339Nano)
	in.Source = strings.TrimSpace(in.Source)
	in.ExternalID = strings.TrimSpace(in.ExternalID)
	in.Title = strings.TrimSpace(in.Title)
	tags := map[string]bool{}
	for _, tag := range in.Tags {
		if !importText(tag, 50) {
			return ImportPreview{}, invalid()
		}
		tags[strings.TrimSpace(tag)] = true
	}
	in.Tags = []string{}
	for tag := range tags {
		in.Tags = append(in.Tags, tag)
	}
	sort.Strings(in.Tags)
	received := len(in.Indicators)
	unique := map[string]ImportIOC{}
	for i, x := range in.Indicators {
		x.Type = strings.ToLower(strings.TrimSpace(x.Type))
		value, e := normalizeIOC(x.Type, x.Value)
		if e != nil {
			return ImportPreview{}, fault.New(400, "INVALID_IOC", fmt.Sprintf("Indicator %d: unsupported type or invalid value. Supported: ip, domain, url, hash_sha256, hash_md5.", i+1))
		}
		x.Value = value
		if x.Severity == "" {
			x.Severity = in.Severity
		}
		if rank[x.Severity] == 0 {
			return ImportPreview{}, invalid()
		}
		key := x.Type + ":" + value
		if old, ok := unique[key]; !ok || rank[x.Severity] > rank[old.Severity] {
			unique[key] = x
		}
	}
	keys := []string{}
	for key := range unique {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	in.Indicators = []ImportIOC{}
	for _, key := range keys {
		in.Indicators = append(in.Indicators, unique[key])
	}
	raw, _ := json.Marshal(in)
	hash := sha256.Sum256(raw)
	return ImportPreview{in, received, len(unique), received - len(unique), hex.EncodeToString(hash[:]), "local-json"}, nil
}
func (s Store) ImportJSON(ctx context.Context, tenant, actor string, in IntelImport) (map[string]any, error) {
	preview, err := PreviewImport(in)
	if err != nil {
		return nil, err
	}
	in = preview.Document
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := threatsql.New(tx)
	if err = q.LockIntelImport(ctx, "threat-intelligence:"+tenant); err != nil {
		return nil, err
	}
	prior, e := q.IntelImportReceipt(ctx, threatsql.IntelImportReceiptParams{TenantID: tenant, Source: in.Source, ExternalID: in.ExternalID})
	if e == nil {
		if prior.ContentHash != preview.Hash {
			return nil, fault.New(409, "IMPORT_CONFLICT", "This source/external ID already has different content. Use a new external ID for a revised report.")
		}
		if !prior.Available {
			return nil, fault.New(410, "REPORT_DELETED", "This import's report was deleted; replay does not recreate it.")
		}
		return map[string]any{"report_id": prior.ReportID, "replayed": true, "preview": preview}, tx.Commit(ctx)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	if err = q.EnsureImportTenant(ctx, tenant); err != nil {
		return nil, err
	}
	reportID := "TIR-" + jobs.ID()
	at, _ := time.Parse(time.RFC3339Nano, in.PublishedAt)
	tags, _ := json.Marshal(in.Tags)
	if err = q.InsertImportedReport(ctx, threatsql.InsertImportedReportParams{TenantID: tenant, ID: reportID, Title: in.Title, Summary: in.Summary, Source: in.Source, Severity: in.Severity, IocCount: int32(preview.Unique), Tags: tags, PublishedAt: pgtype.Timestamptz{Time: at, Valid: true}}); err != nil {
		return nil, err
	}
	for _, ioc := range in.Indicators {
		if err = q.InsertImportedIndicator(ctx, threatsql.InsertImportedIndicatorParams{TenantID: tenant, ID: "IOC-" + jobs.ID(), ReportID: reportID, IndicatorType: ioc.Type, Value: ioc.Value, Severity: ioc.Severity}); err != nil {
			return nil, err
		}
	}
	receipt := map[string]any{"source": in.Source, "external_id": in.ExternalID, "content_hash": preview.Hash, "mode": "local-json", "actor": actor, "published_at": in.PublishedAt, "imported_at": time.Now().UTC(), "received": preview.Received, "unique": preview.Unique, "duplicates": preview.Duplicates}
	raw, _ := json.Marshal(receipt)
	if err = q.InsertIntelImportReceipt(ctx, threatsql.InsertIntelImportReceiptParams{TenantID: tenant, Source: in.Source, ExternalID: in.ExternalID, ReportID: reportID, ContentHash: preview.Hash, Actor: actor, Document: raw}); err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "threat_intel_reports", reportID, "json_imported", receipt); err != nil {
		return nil, err
	}
	return map[string]any{"report_id": reportID, "replayed": false, "preview": preview}, tx.Commit(ctx)
}
