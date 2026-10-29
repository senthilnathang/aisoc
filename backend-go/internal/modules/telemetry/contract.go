// Package telemetry defines the new streaming boundary. It does not change HTTP
// intake, connect to providers, or execute actions.
package telemetry

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"regexp"
	"strings"
	"time"
)

const MaxEnvelopeBytes = 16384

var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
var ErrInvalid = errors.New("invalid telemetry envelope")
var ErrBinding = errors.New("telemetry source binding mismatch")

// Binding must come from authenticated connector configuration, never the body.
type Binding struct{ TenantID, ConnectorID, Source string }

type Projection struct {
	PrincipalRef string `json:"principal_ref"`
	AssetRef     string `json:"asset_ref"`
	SourceIP     string `json:"source_ip"`
}

type Event struct {
	SchemaVersion  string     `json:"schema_version"`
	EventID        string     `json:"event_id"`
	TenantID       string     `json:"tenant_id"`
	ConnectorID    string     `json:"connector_id"`
	Source         string     `json:"source"`
	SourceEventID  string     `json:"source_event_id"`
	SourceRevision string     `json:"source_revision"`
	EventType      string     `json:"event_type"`
	EventTime      string     `json:"event_time"`
	IngestedAt     string     `json:"ingested_at"`
	Severity       string     `json:"severity"`
	EvidenceRef    string     `json:"evidence_ref"`
	TraceID        string     `json:"trace_id"`
	Projection     Projection `json:"projection"`
}

// Decode rejects oversized, unknown, duplicate-key and non-canonical timestamp
// inputs before any side effect. Error text never echoes evidence or credentials.
func Decode(raw []byte, binding Binding) (Event, error) {
	var event Event
	if len(raw) == 0 || len(raw) > MaxEnvelopeBytes {
		return event, ErrInvalid
	}
	if err := uniqueJSON(raw); err != nil {
		return event, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&event); err != nil {
		return Event{}, ErrInvalid
	}
	if err := event.Validate(binding); err != nil {
		return Event{}, err
	}
	return event, nil
}

func (e Event) Validate(binding Binding) error {
	for _, v := range []string{e.EventID, e.TenantID, e.ConnectorID, e.Source, e.SourceEventID, e.SourceRevision, e.TraceID, e.EvidenceRef, e.Projection.PrincipalRef, e.Projection.AssetRef} {
		if !identifier.MatchString(v) {
			return ErrInvalid
		}
	}
	if e.SchemaVersion != "1.0" || (e.EventType != "authentication.failed" && e.EventType != "authentication.succeeded") {
		return ErrInvalid
	}
	if e.Severity != "low" && e.Severity != "medium" && e.Severity != "high" && e.Severity != "critical" {
		return ErrInvalid
	}
	if !utc(e.EventTime) || !utc(e.IngestedAt) {
		return ErrInvalid
	}
	ip, err := netip.ParseAddr(e.Projection.SourceIP)
	if err != nil || ip.Zone() != "" {
		return ErrInvalid
	}
	if e.TenantID != binding.TenantID || e.ConnectorID != binding.ConnectorID || e.Source != binding.Source {
		return ErrBinding
	}
	return nil
}

func utc(s string) bool {
	t, err := time.Parse(time.RFC3339Nano, s)
	return err == nil && t.Year() >= 1970 && t.Year() <= 9999 && strings.HasSuffix(s, "Z") && len(s) <= 30
}

// Identity excludes delivery-specific event/trace IDs. Hash arrays preserve field
// boundaries; concatenating unescaped IDs with delimiters would be ambiguous.
func (e Event) Identity() string {
	return digest([]string{e.TenantID, e.ConnectorID, e.Source, e.SourceEventID, e.EventType, e.SourceRevision})
}

// ContentHash detects conflicting revisions without treating retries as changes.
// Normalize timestamps/IPs so equivalent JSON representations hash identically.
func (e Event) ContentHash() string {
	e.EventID, e.IngestedAt, e.TraceID = "", "", ""
	if t, err := time.Parse(time.RFC3339Nano, e.EventTime); err == nil {
		e.EventTime = t.UTC().Format(time.RFC3339Nano)
	}
	if ip, err := netip.ParseAddr(e.Projection.SourceIP); err == nil {
		e.Projection.SourceIP = ip.Unmap().String()
	}
	return digest(e)
}

func digest(value any) string {
	raw, _ := json.Marshal(value) // Only fixed structs/string arrays enter here.
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

// Duplicate JSON keys are rejected instead of silently taking the last value.
func uniqueJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 8 {
			return ErrInvalid
		}
		t, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, err := d.Token()
				if err != nil {
					return err
				}
				key, ok := k.(string)
				if !ok || seen[key] {
					return ErrInvalid
				}
				seen[key] = true
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for d.More() {
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
		default:
			return ErrInvalid
		}
		_, err = d.Token()
		return err
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return ErrInvalid
	}
	return nil
}
