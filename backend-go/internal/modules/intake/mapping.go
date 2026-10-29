package intake

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Keys preserves JavaScript property order, including integer-like keys and
// the first insertion position of duplicate properties.
func Keys(raw []byte) []string {
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil
	}
	keys, numbers := []string{}, []string{}
	seen := map[string]bool{}
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return nil
		}
		key, ok := token.(string)
		if !ok {
			return nil
		}
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return nil
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		n, e := strconv.ParseUint(key, 10, 32)
		if e == nil && n < 4294967295 && strconv.FormatUint(n, 10) == key {
			numbers = append(numbers, key)
		} else {
			keys = append(keys, key)
		}
	}
	sort.Slice(numbers, func(i, j int) bool {
		a, _ := strconv.ParseUint(numbers[i], 10, 32)
		b, _ := strconv.ParseUint(numbers[j], 10, 32)
		return a < b
	})
	return append(numbers, keys...)
}

type Mapping struct {
	Fields      map[string]string `json:"fields"`
	SeverityMap map[string]string `json:"severity_map,omitempty"`
	Order       []string          `json:"-"`
}

var pathPart = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]*$`)

func allowed(v string, values ...string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}
func CheckMapping(input map[string]any, order, severityOrder []string) (Mapping, []string) {
	errors := []string{}
	fields := input["fields"].(map[string]any)
	m := Mapping{Fields: map[string]string{}, Order: order}
	for _, key := range order {
		path := fields[key].(string)
		m.Fields[key] = path
		if !allowed(key, "external_id", "title", "severity", "summary", "category", "alert_type", "primary_entity", "insight_refs", "evidence") {
			errors = append(errors, "Unsupported normalized field: "+key+".")
			continue
		}
		valid := path != ""
		for _, part := range strings.Split(path, ".") {
			valid = valid && pathPart.MatchString(part)
		}
		if !valid {
			errors = append(errors, "Field "+key+" must use a safe dot path, such as alert.id.")
		}
	}
	for _, key := range []string{"external_id", "title", "severity"} {
		if m.Fields[key] == "" {
			errors = append(errors, "Map required field "+key+".")
		}
	}
	if v, ok := input["severity_map"]; ok {
		m.SeverityMap = map[string]string{}
		values := v.(map[string]any)
		for _, key := range severityOrder {
			target := values[key].(string)
			if trim(key) == "" {
				label := key
				if key == "" {
					label = "(empty)"
				}
				errors = append(errors, "Severity mapping for "+label+" must target low, medium, high, or critical.")
			} else {
				m.SeverityMap[strings.ToLower(key)] = target
			}
		}
	}
	return m, errors
}
func (m Mapping) Value() map[string]any {
	v := map[string]any{"fields": m.Fields}
	if m.SeverityMap != nil {
		v["severity_map"] = m.SeverityMap
	}
	return v
}
func readPath(sample map[string]any, path string) any {
	var value any = sample
	for _, part := range strings.Split(path, ".") {
		v, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = v[part]
	}
	return value
}
func scalar(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		return trim(x), true
	case float64:
		if x == 0 {
			return "0", true
		}
		raw, _ := json.Marshal(x)
		return string(raw), true
	}
	return "", false
}
func (m Mapping) Preview(source, rule string, sample map[string]any) map[string]any {
	output := map[string]any{"source": source, "rule_id": rule}
	errors := []string{}
	for _, field := range m.Order {
		path := m.Fields[field]
		found := readPath(sample, path)
		if found == nil || found == "" {
			if allowed(field, "external_id", "title", "severity") {
				errors = append(errors, field+": no value found at "+path+".")
			}
			continue
		}
		switch field {
		case "insight_refs":
			values, ok := found.([]any)
			refs := []string{}
			seen := map[string]bool{}
			if ok {
				for _, v := range values {
					text, isString := v.(string)
					if !isString {
						ok = false
						break
					}
					text = trim(text)
					if text != "" && !seen[text] {
						refs = append(refs, text)
						seen[text] = true
					}
				}
			}
			if !ok {
				errors = append(errors, "insight_refs: expected an array of strings at "+path+".")
			} else {
				output[field] = refs
			}
		case "evidence":
			values, ok := found.([]any)
			if !ok {
				errors = append(errors, "evidence: expected an array at "+path+".")
				continue
			}
			evidence := []map[string]any{}
			for i, v := range values {
				record, ok := v.(map[string]any)
				if !ok {
					errors = append(errors, fmt.Sprintf("evidence[%d]: expected an object with type and value.", i))
					continue
				}
				kind, _ := record["type"].(string)
				value, ok := scalar(record["value"])
				if !allowed(kind, "entity", "ip", "domain", "file", "email", "url") || !ok || value == "" {
					errors = append(errors, fmt.Sprintf("evidence[%d]: expected a supported type and non-empty value.", i))
					continue
				}
				item := map[string]any{"type": kind, "value": value}
				if label, ok := record["label"].(string); ok {
					item["label"] = label
				}
				evidence = append(evidence, item)
			}
			output[field] = evidence
		default:
			text, ok := scalar(found)
			if !ok {
				errors = append(errors, field+": expected a string or number at "+path+".")
				continue
			}
			if field == "severity" {
				severity := strings.ToLower(text)
				if alias, ok := m.SeverityMap[severity]; ok {
					severity = alias
				}
				if !allowed(severity, "low", "medium", "high", "critical") {
					errors = append(errors, "severity: "+text+" is not a supported severity. Add it to severity_map.")
				} else {
					output[field] = severity
				}
			} else {
				output[field] = text
			}
		}
	}
	if len(errors) > 0 {
		return map[string]any{"valid": false, "errors": errors, "normalized_alert": nil}
	}
	return map[string]any{"valid": true, "errors": errors, "normalized_alert": output}
}
func (s Store) SaveMapping(ctx context.Context, tenant, id string, m Mapping, issues []string, actor string) (map[string]any, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM api_sources WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, id)); err != nil {
		return nil, err
	}
	if len(issues) > 0 {
		return nil, fault.New(400, "INVALID_EVENT_MAPPING", strings.Join(issues, " "))
	}
	raw, err := json.Marshal(m.Value())
	if err != nil {
		return nil, err
	}
	v, err := scan(tx.QueryRow(ctx, `UPDATE api_sources SET mapping=$3,mapping_order=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2 RETURNING `+columns, tenant, id, raw, m.Order, time.Now().UTC().Truncate(time.Millisecond)))
	if err != nil {
		return nil, err
	}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "api_sources", id, "source_mapping_updated", map[string]any{"actor_id": actor}); err != nil {
		return nil, err
	}
	return v.View(), tx.Commit(ctx)
}
