package migration

import (
	"aisoc/backend/internal/modules/connectors"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Row map[string]any

var order = strings.Fields("response_plans investigations detection_rules detection_rule_versions api_sources connectors hunts remediations threat_intel_reports threat_indicators artifacts investigation_feedback investigation_steps audit_events alerts investigation_jobs response_plan_versions case_runbooks case_runbook_events skills skill_materials skill_material_versions skill_suggestions skill_applications skill_application_feedback")
var jsonFields = map[string]string{"investigations": "insight_refs", "artifacts": "metadata", "investigation_steps": "request response", "audit_events": "details", "detection_rules": "mitre_techniques", "connectors": "config", "hunts": "insight_refs", "threat_intel_reports": "tags", "alerts": "payload", "investigation_jobs": "result", "api_sources": "mapping", "skills": "modules connectors alert_types alert_categories source_entities runtime_entities insight_refs tags"}
var columns = map[string]string{
	"response_plans": "tenant_id id document_json", "response_plan_versions": "tenant_id plan_id version snapshot_json action actor created_at",
	"case_runbooks": "tenant_id id investigation_id plan_id document_json", "case_runbook_events": "tenant_id assignment_id version document_json",
	"investigations": "id tenant_id title summary source category severity status determination risk_score owner primary_entity replay_count created_at updated_at insight_refs_json",
	"artifacts":      "id tenant_id investigation_id type value label metadata_json created_at updated_at", "investigation_feedback": "id tenant_id investigation_id comment created_at updated_at",
	"investigation_steps": "id tenant_id investigation_id title conclusion tool request_json response_json created_at updated_at", "audit_events": "id tenant_id resource resource_id action details_json created_at updated_at",
	"detection_rules":         "id tenant_id name description mitre_techniques_json execution_mode enabled severity detections investigations false_positive_rate recommendation_status last_activity_at created_at updated_at query schedule lookback_window routing",
	"detection_rule_versions": "tenant_id rule_id version snapshot_json created_at", "api_sources": "id tenant_id name provider rule_id key_hash expires_at revoked_at created_at updated_at mapping_json",
	"connectors": "id tenant_id type name description workspace_url client_id secret_ciphertext config_json status last_tested_at created_at updated_at", "hunts": "id tenant_id name query source status verdict findings_count last_run_at created_at updated_at insight_refs_json",
	"remediations": "id tenant_id investigation_id action_type title description connector status executed_at created_at updated_at", "threat_intel_reports": "id tenant_id title summary source report_type severity status ioc_count hunt_status hunts_launched findings_count tags_json published_at created_at updated_at",
	"threat_indicators": "id tenant_id report_id indicator_type value severity status hits last_seen_at created_at updated_at", "alerts": "id tenant_id source external_id rule_id investigation_id title severity routing disposition payload_json payload_hash created_at updated_at",
	"investigation_jobs":         "id tenant_id investigation_id alert_id status phase error result_json created_at updated_at",
	"skills":                     "id tenant_id name skill_type description apply_when content_markdown modules_json connectors_json alert_types_json alert_categories_json source_entities_json runtime_entities_json insight_refs_json tags_json origin state enabled version created_by created_at updated_at",
	"skill_materials":            "id tenant_id skill_id name kind file_type source_url content version archived_at created_by created_at updated_at",
	"skill_material_versions":    "tenant_id material_id version snapshot_json created_by created_at",
	"skill_suggestions":          "id tenant_id signature name explanation source category case_count feedback_count sample_case_ids_json draft_json status accepted_skill_id created_at updated_at",
	"skill_applications":         "id tenant_id skill_id target_type target_id skill_version reason snapshot_json created_at",
	"skill_application_feedback": "id tenant_id application_id rating comment created_by created_at updated_at",
}

func copyRow(r Row) Row {
	out := Row{}
	for k, v := range r {
		out[k] = v
	}
	return out
}
func pick(r Row, keys string) Row {
	out := Row{}
	for _, key := range strings.Fields(keys) {
		out[key] = r[key]
	}
	return out
}
func decode(v any) (any, error) {
	s, ok := v.(string)
	if !ok {
		return nil, fmt.Errorf("JSON column is not text")
	}
	var out any
	err := json.Unmarshal([]byte(s), &out)
	return out, err
}
func encode(v any) string { b, _ := json.Marshal(v); return string(b) }
func target(name string) string {
	if name == "artifacts" || name == "investigation_feedback" {
		return "case_records"
	}
	return name
}
func forward(name string, original Row, key []byte, versions map[string]any) (Row, error) {
	r := copyRow(original)
	for _, field := range strings.Fields(jsonFields[name]) {
		v, err := decode(r[field+"_json"])
		if err != nil {
			return nil, err
		}
		r[field] = v
		delete(r, field+"_json")
	}
	if name == "skills" || name == "detection_rules" {
		r["enabled"] = fmt.Sprint(r["enabled"]) == "1"
	}
	base := pick(r, "tenant_id id")
	switch name {
	case "response_plans", "case_runbooks", "case_runbook_events":
		doc, err := decode(r["document_json"])
		if err != nil {
			return nil, err
		}
		delete(r, "document_json")
		r["document"] = doc
		return r, nil
	case "response_plan_versions", "detection_rule_versions", "skill_material_versions":
		doc, err := decode(r["snapshot_json"])
		if err != nil {
			return nil, err
		}
		delete(r, "snapshot_json")
		r["snapshot"] = doc
		return r, nil
	case "artifacts", "investigation_feedback":
		base["kind"] = "artifacts"
		if name == "investigation_feedback" {
			base["kind"] = "feedback"
		}
		for _, k := range []string{"investigation_id", "created_at", "updated_at"} {
			base[k] = r[k]
		}
		base["document"] = r
		return base, nil
	case "investigation_steps":
		base["investigation_id"] = r["investigation_id"]
		base["created_at"] = r["created_at"]
		base["document"] = r
		return base, nil
	case "connectors":
		secret, _ := r["secret_ciphertext"].(string)
		delete(r, "secret_ciphertext")
		encrypted, err := connectors.EncryptSecret(key, r["tenant_id"].(string), r["id"].(string), secret)
		if err != nil {
			return nil, err
		}
		base["secret_ciphertext"] = nil
		if encrypted != nil {
			base["secret_ciphertext"] = "\\x" + hex.EncodeToString(encrypted)
		}
		base["document"] = r
		base["updated_at"] = r["updated_at"]
		return base, nil
	case "detection_rules":
		base["document"] = r
		base["updated_at"] = r["updated_at"]
		base["version"] = 1
		if v, ok := versions[fmt.Sprint(r["tenant_id"])+"\x00"+fmt.Sprint(r["id"])]; ok {
			base["version"] = v
		}
		return base, nil
	case "hunts", "remediations":
		base["document"] = r
		base["updated_at"] = r["updated_at"]
		if name == "remediations" {
			base["investigation_id"] = r["investigation_id"]
		}
		return base, nil
	case "alerts":
		base = pick(r, "tenant_id id source external_id rule_id investigation_id created_at")
		base["payload_hash"] = "\\x" + fmt.Sprint(r["payload_hash"])
		delete(r, "payload_hash")
		base["document"] = r
		return base, nil
	case "api_sources":
		if r["key_hash"] != nil {
			r["key_hash"] = "\\x" + fmt.Sprint(r["key_hash"])
		}
		r["mapping_order"] = mappingOrder(original["mapping_json"].(string))
		return r, nil
	case "skills":
		base["document"] = r
		base["tags_search"] = original["tags_json"]
		base["updated_at"] = r["updated_at"]
		return base, nil
	case "skill_materials":
		base["skill_id"] = r["skill_id"]
		base["document"] = r
		return base, nil
	case "skill_suggestions":
		base["signature"] = r["signature"]
		base["document"] = r
		return base, nil
	case "skill_applications":
		base = pick(r, "tenant_id id skill_id target_type target_id skill_version")
		base["document"] = r
		return base, nil
	case "skill_application_feedback":
		base = pick(r, "tenant_id id application_id created_by")
		base["document"] = r
		return base, nil
	default:
		return r, nil
	}
}
func mappingOrder(raw string) []string {
	var obj map[string]json.RawMessage
	_ = json.Unmarshal([]byte(raw), &obj)
	d := json.NewDecoder(strings.NewReader(string(obj["fields"])))
	_, err := d.Token()
	if err != nil {
		return []string{}
	}
	out := []string{}
	for d.More() {
		k, e := d.Token()
		if e != nil {
			break
		}
		var discard any
		if d.Decode(&discard) != nil {
			break
		}
		out = append(out, k.(string))
	}
	return out
}
func backward(name string, stored Row, key []byte) (Row, error) {
	r := copyRow(stored)
	delete(r, "ordinal")
	if doc, ok := r["document"].(map[string]any); ok && name != "response_plans" && name != "case_runbooks" && name != "case_runbook_events" {
		r = copyRow(doc)
	}
	if name == "response_plans" || name == "case_runbooks" || name == "case_runbook_events" {
		r["document_json"] = encode(r["document"])
		delete(r, "document")
	}
	if name == "response_plan_versions" || name == "detection_rule_versions" || name == "skill_material_versions" {
		r["snapshot_json"] = encode(r["snapshot"])
		delete(r, "snapshot")
	}
	for _, field := range strings.Fields(jsonFields[name]) {
		r[field+"_json"] = encode(r[field])
		delete(r, field)
	}
	if name == "api_sources" {
		// JSONB does not retain field order. Legacy validation reports mapping
		// errors in insertion order, so reconstruct the saved fields sequence.
		var mapping map[string]json.RawMessage
		if err := json.Unmarshal([]byte(r["mapping_json"].(string)), &mapping); err != nil {
			return nil, err
		}
		var fields map[string]json.RawMessage
		if raw, ok := mapping["fields"]; ok {
			if err := json.Unmarshal(raw, &fields); err != nil {
				return nil, err
			}
			parts := []string{}
			if sequence, ok := stored["mapping_order"].([]any); ok {
				for _, value := range sequence {
					field, ok := value.(string)
					if raw, exists := fields[field]; ok && exists {
						parts = append(parts, encode(field)+":"+string(raw))
						delete(fields, field)
					}
				}
			}
			if len(fields) != 0 {
				return nil, fmt.Errorf("mapping order is incomplete")
			}
			mapping["fields"] = json.RawMessage("{" + strings.Join(parts, ",") + "}")
			r["mapping_json"] = encode(mapping)
		}
	}
	if name == "skills" || name == "detection_rules" {
		if r["enabled"] == true {
			r["enabled"] = 1
		} else {
			r["enabled"] = 0
		}
	}
	if name == "connectors" {
		var encrypted []byte
		if v, ok := stored["secret_ciphertext"].(string); ok {
			var err error
			encrypted, err = hex.DecodeString(strings.TrimPrefix(v, "\\x"))
			if err != nil {
				return nil, err
			}
		}
		secret, err := connectors.DecryptSecret(key, encrypted, r["tenant_id"].(string), r["id"].(string))
		if err != nil {
			return nil, err
		}
		r["secret_ciphertext"] = secret
	}
	for _, field := range []string{"payload_hash", "key_hash"} {
		if v, ok := stored[field].(string); ok {
			r[field] = strings.TrimPrefix(v, "\\x")
		}
	}
	for k, v := range r {
		if strings.HasSuffix(k, "_at") {
			if s, ok := v.(string); ok {
				if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
					r[k] = t.UTC().Format("2006-01-02T15:04:05.000Z")
				}
			}
		}
	}
	return pick(r, columns[name]), nil
}
