package intake

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"sort"
	"time"
	"unicode/utf16"
)

type Evidence struct {
	Type  string `json:"type"`
	Value string `json:"value"`
	Label string `json:"label"`
}

// Field order matches the legacy JSON hash input. Optional empty insight arrays
// remain distinct from an absent field, as in the original normalizer.
type AlertInput struct {
	Source        string     `json:"source"`
	ExternalID    string     `json:"external_id"`
	RuleID        string     `json:"rule_id"`
	Title         string     `json:"title"`
	Severity      string     `json:"severity"`
	Summary       string     `json:"summary"`
	PrimaryEntity string     `json:"primary_entity"`
	Evidence      []Evidence `json:"evidence"`
	Category      string     `json:"category,omitempty"`
	AlertType     string     `json:"alert_type,omitempty"`
	InsightRefs   *[]string  `json:"insight_refs,omitempty"`
}

func jsonBytes(value any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(value); err != nil {
		return nil, err
	}
	raw := bytes.TrimSuffix(b.Bytes(), []byte("\n"))
	// JSON.stringify keeps these two Unicode separators literal. Go escapes them
	// even with HTML escaping disabled. Skip escaped backslashes so a literal
	// six-character "\\u2028" value is not accidentally changed.
	out := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); {
		if raw[i] == '\\' && i+1 < len(raw) {
			if i+6 <= len(raw) && (string(raw[i:i+6]) == `\u2028` || string(raw[i:i+6]) == `\u2029`) {
				if raw[i+5] == '8' {
					out = append(out, []byte("\u2028")...)
				} else {
					out = append(out, []byte("\u2029")...)
				}
				i += 6
				continue
			}
			out = append(out, raw[i:i+2]...)
			i += 2
			continue
		}
		out = append(out, raw[i])
		i++
	}
	return out, nil
}
func normalize(in AlertInput) AlertInput {
	in.Source = trim(in.Source)
	in.ExternalID = trim(in.ExternalID)
	in.RuleID = trim(in.RuleID)
	in.Title = trim(in.Title)
	in.Summary = trim(in.Summary)
	in.PrimaryEntity = trim(in.PrimaryEntity)
	in.Category = trim(in.Category)
	in.AlertType = trim(in.AlertType)
	if in.Evidence == nil {
		in.Evidence = []Evidence{}
	}
	for i := range in.Evidence {
		in.Evidence[i].Value = trim(in.Evidence[i].Value)
		in.Evidence[i].Label = trim(in.Evidence[i].Label)
	}
	if in.InsightRefs != nil && len(*in.InsightRefs) > 0 {
		refs := []string{}
		seen := map[string]bool{}
		for _, v := range *in.InsightRefs {
			v = trim(v)
			if v != "" && !seen[v] {
				refs = append(refs, v)
				seen[v] = true
			}
		}
		sort.Slice(refs, func(i, j int) bool {
			a, b := utf16.Encode([]rune(refs[i])), utf16.Encode([]rune(refs[j]))
			for k := 0; k < len(a) && k < len(b); k++ {
				if a[k] != b[k] {
					return a[k] < b[k]
				}
			}
			return len(a) < len(b)
		})
		in.InsightRefs = &refs
	} else {
		in.InsightRefs = nil
	}
	return in
}
func unauthorized() error {
	return fault.New(401, "UNAUTHENTICATED", "A valid credential is required.")
}
func validKey(s Source, key string) bool {
	hash := sha256.Sum256([]byte(key))
	return s.Revoked == nil && s.Expires.After(time.Now()) && subtle.ConstantTimeCompare(hash[:], s.Hash) == 1
}

// IngestSource holds the source row lock through commit, serializing credential
// changes and mapping saves with ingestion. All entry points share the same
// deduplication lock, normalization, routing and atomic persistence path.
func (s Store) IngestSource(ctx context.Context, tenant, id, key string, input AlertInput, native map[string]any) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	source, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM api_sources WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id))
	if err != nil {
		var f *fault.Error
		if errors.As(err, &f) && f.Status == 404 {
			return nil, unauthorized()
		}
		return nil, err
	}
	if !validKey(source, key) {
		return nil, unauthorized()
	}
	if native != nil {
		raw, _ := json.Marshal(source.Mapping)
		var mapping Mapping
		if err = json.Unmarshal(raw, &mapping); err != nil {
			return nil, err
		}
		if len(mapping.Fields) == 0 {
			return nil, fault.New(409, "MAPPING_NOT_CONFIGURED", "Configure and save a valid event mapping before sending native events.")
		}
		if err = tx.QueryRow(ctx, `SELECT mapping_order FROM api_sources WHERE id=$1`, id).Scan(&mapping.Order); err != nil {
			return nil, err
		}
		mapped := mapping.Preview("api-source:"+id, source.Rule, native)
		if mapped["valid"] != true {
			return nil, &fault.Error{Status: 400, Code: "NATIVE_EVENT_INVALID", Message: "The native event could not be mapped.", Details: mapped["errors"]}
		}
		raw, err = json.Marshal(mapped["normalized_alert"])
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &input); err != nil {
			return nil, err
		}
	}
	input.Source = "api-source:" + id
	input.RuleID = source.Rule
	result, err := s.ingest(ctx, tx, tenant, normalize(input), func() error {
		if !validKey(source, key) {
			return unauthorized()
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

// IngestOperator uses the authenticated operator's tenant, never a payload
// tenant. Operators may name their source/rule as in the legacy alert endpoint.
func (s Store) IngestOperator(ctx context.Context, tenant string, input AlertInput) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	result, err := s.ingest(ctx, tx, tenant, normalize(input), nil)
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (s Store) ingest(ctx context.Context, tx pgx.Tx, tenant string, input AlertInput, authorize func() error) (map[string]any, error) {
	// A rule lock alone cannot serialize conflicting submissions that reuse an
	// external ID but name different rules. This lock matches the unique key and
	// is shared by source-key and operator ingestion; collisions only serialize.
	lockKey, err := jsonBytes([]string{tenant, input.Source, input.ExternalID})
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, string(lockKey)); err != nil {
		return nil, err
	}
	if authorize != nil {
		if err = authorize(); err != nil {
			return nil, err
		}
	}
	raw, err := jsonBytes(input)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	var existing map[string]any
	var existingHash []byte
	err = tx.QueryRow(ctx, `SELECT document,payload_hash FROM alerts WHERE tenant_id=$1 AND source=$2 AND external_id=$3`, tenant, input.Source, input.ExternalID).Scan(&existing, &existingHash)
	if err == nil {
		if !bytes.Equal(hash[:], existingHash) {
			return nil, fault.New(409, "ALERT_CONFLICT", "This source alert ID already exists with different content.")
		}
		return map[string]any{"duplicate": true, "alert": existing}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var rule map[string]any
	err = tx.QueryRow(ctx, `SELECT document FROM detection_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, input.RuleID).Scan(&rule)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fault.New(404, "NOT_FOUND", "Detection rule not found")
	}
	if err != nil {
		return nil, err
	}
	if authorize != nil {
		if err = authorize(); err != nil {
			return nil, err
		}
	}
	if rule["enabled"] != true {
		return nil, fault.New(409, "RULE_DISABLED", "Enable the detection rule before ingesting alerts.")
	}
	routing, _ := rule["routing"].(string)
	sampleKey, _ := jsonBytes([]string{tenant, input.Source, input.ExternalID})
	sampleHash := sha256.Sum256(sampleKey)
	sampled := binary.BigEndian.Uint32(sampleHash[:4])%10 == 0
	disposition := "investigate"
	if routing == "Suppress" {
		disposition = "suppressed"
	} else if routing == "Sample (10%)" && !sampled {
		disposition = "not_sampled"
	}
	alertID := "ALT-" + jobs.ID()
	var caseID any
	now := time.Now().UTC().Truncate(time.Millisecond)
	if disposition == "investigate" {
		caseID = "INV-" + jobs.ID()
		owner := "Local investigation worker"
		if routing == "Escalate" {
			owner = "Analyst review"
		}
		category := input.Category
		if category == "" {
			category = "other"
		}
		refs := []string{}
		if input.InsightRefs != nil {
			refs = *input.InsightRefs
		}
		refsJSON, _ := json.Marshal(refs)
		if _, err = tx.Exec(ctx, `INSERT INTO investigations(tenant_id,id,title,summary,source,category,severity,status,determination,owner,primary_entity,insight_refs,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'open','unknown',$8,$9,$10,$11,$11)`, tenant, caseID, input.Title, input.Summary, input.Source, category, input.Severity, owner, input.PrimaryEntity, refsJSON, now); err != nil {
			return nil, err
		}
	}
	document := map[string]any{"id": alertID, "tenant_id": tenant, "source": input.Source, "external_id": input.ExternalID, "rule_id": input.RuleID, "investigation_id": caseID, "title": input.Title, "severity": input.Severity, "routing": routing, "disposition": disposition, "payload": input, "created_at": investigations.Timestamp(now), "updated_at": investigations.Timestamp(now)}
	docJSON, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO alerts(tenant_id,id,source,external_id,rule_id,investigation_id,document,payload_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, tenant, alertID, input.Source, input.ExternalID, input.RuleID, caseID, docJSON, hash[:], now); err != nil {
		return nil, err
	}
	if caseID != nil {
		if _, err = skills.Apply(ctx, tx, tenant, "investigation", caseID.(string), skillContext(input, nil)); err != nil {
			return nil, err
		}
	}
	if caseID != nil {
		if _, err = tx.Exec(ctx, `INSERT INTO investigation_jobs(tenant_id,id,investigation_id,alert_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`, tenant, "JOB-"+jobs.ID(), caseID, alertID, now); err != nil {
			return nil, err
		}
		if err = investigations.Audit(ctx, tx, tenant, caseID.(string), "alert_received", map[string]any{"alert_id": alertID, "rule_id": input.RuleID}); err != nil {
			return nil, err
		}
	}
	count := func(key string) float64 { v, _ := rule[key].(float64); return v }
	rule["detections"] = count("detections") + 1
	rule["investigations"] = count("investigations")
	if caseID != nil {
		rule["investigations"] = count("investigations") + 1
	}
	rule["last_activity_at"] = investigations.Timestamp(now)
	rule["updated_at"] = investigations.Timestamp(now)
	ruleJSON, _ := json.Marshal(rule)
	if _, err = tx.Exec(ctx, `UPDATE detection_rules SET document=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2`, tenant, input.RuleID, ruleJSON, now); err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_rules", input.RuleID, "alert_received", map[string]any{"alert_id": alertID, "disposition": disposition}); err != nil {
		return nil, err
	}
	return map[string]any{"duplicate": false, "alert": document}, nil
}
func (s Store) Alert(ctx context.Context, tenant, id string) (map[string]any, error) {
	var record map[string]any
	err := s.Pool.QueryRow(ctx, `SELECT document FROM alerts WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&record)
	if errors.Is(err, pgx.ErrNoRows) {
		err = fault.New(404, "NOT_FOUND", "Alert not found")
	}
	return record, err
}
func (s Store) Alerts(ctx context.Context, tenant string, limit, offset int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT document FROM alerts WHERE tenant_id=$1 ORDER BY created_at DESC,ordinal DESC LIMIT $2 OFFSET $3`, tenant, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var item map[string]any
		if err = rows.Scan(&item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func skillContext(input AlertInput, matches []any) skills.Context {
	title := input.AlertType
	if title == "" {
		title = input.Title
	}
	category := input.Category
	if category == "" {
		category = "other"
	}
	c := skills.Context{Module: "investigations", Source: input.Source, Title: title, Category: category, SourceEntities: []string{input.PrimaryEntity}}
	for _, e := range input.Evidence {
		c.SourceEntities = append(c.SourceEntities, e.Type, e.Label, e.Value)
	}
	for _, m := range matches {
		if row, ok := m.(map[string]any); ok {
			for _, key := range []string{"indicator_type", "value"} {
				if v, ok := row[key].(string); ok {
					c.RuntimeEntities = append(c.RuntimeEntities, v)
				}
			}
		}
	}
	if input.InsightRefs != nil {
		c.InsightRefs = *input.InsightRefs
	}
	return c
}
