import { ApiError } from "../errors.js";
import type { AlertInput } from "./alert-pipeline.js";

export const ALERT_FIELDS = ["external_id", "title", "severity", "summary", "category", "alert_type", "primary_entity", "insight_refs", "evidence"] as const;
export type AlertField = (typeof ALERT_FIELDS)[number];
export type AlertMapping = {
  fields: Partial<Record<AlertField, string>>;
  severity_map?: Record<string, "low" | "medium" | "high" | "critical">;
};
const severityValues = new Set(["low", "medium", "high", "critical"]);
const evidenceTypes = new Set(["entity", "ip", "domain", "file", "email", "url"]);
const pathPart = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function checkMapping(value: unknown): { mapping?: AlertMapping; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: ["Mapping must be an object."] };
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["fields", "severity_map"].includes(key))) errors.push("Mapping supports only fields and severity_map.");
  if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) errors.push("Provide a fields object.");
  const fields = (input.fields && typeof input.fields === "object" && !Array.isArray(input.fields) ? input.fields : {}) as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!(ALERT_FIELDS as readonly string[]).includes(key)) { errors.push(`Unsupported normalized field: ${key}.`); continue; }
    const path = fields[key];
    if (typeof path !== "string" || !path || path.split(".").some(part => !pathPart.test(part))) errors.push(`Field ${key} must use a safe dot path, such as alert.id.`);
  }
  for (const required of ["external_id", "title", "severity"] as const) if (typeof fields[required] !== "string" || !fields[required]) errors.push(`Map required field ${required}.`);
  let severityMap: Record<string, "low" | "medium" | "high" | "critical"> | undefined;
  if (input.severity_map !== undefined) {
    if (!input.severity_map || typeof input.severity_map !== "object" || Array.isArray(input.severity_map)) errors.push("severity_map must be an object.");
    else {
      severityMap = {};
      for (const [source, target] of Object.entries(input.severity_map as Record<string, unknown>)) {
        if (!source.trim() || typeof target !== "string" || !severityValues.has(target)) errors.push(`Severity mapping for ${source || "(empty)"} must target low, medium, high, or critical.`);
        else severityMap[source.toLowerCase()] = target as AlertMapping["severity_map"] extends Record<string, infer T> | undefined ? T : never;
      }
    }
  }
  return errors.length ? { errors } : { mapping: { fields: fields as AlertMapping["fields"], ...(severityMap ? { severity_map: severityMap } : {}) }, errors };
}

function readPath(sample: Record<string, unknown>, path: string): unknown {
  let value: unknown = sample;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function mapNativeEvent(value: unknown, source: string, ruleId: string, raw: unknown): { normalized?: AlertInput; errors: string[] } {
  const checked = checkMapping(value);
  if (!checked.mapping) return checked;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["Sample event must be a JSON object."] };
  const mapping = checked.mapping;
  const output: Record<string, unknown> = { source, rule_id: ruleId };
  const errors: string[] = [];
  for (const [field, path] of Object.entries(mapping.fields) as [AlertField, string][]) {
    const found = readPath(raw as Record<string, unknown>, path);
    if (found === undefined || found === null || found === "") {
      if (["external_id", "title", "severity"].includes(field)) errors.push(`${field}: no value found at ${path}.`);
      continue;
    }
    if (["external_id", "title", "severity", "summary", "category", "alert_type", "primary_entity"].includes(field)) {
      if (typeof found !== "string" && typeof found !== "number") { errors.push(`${field}: expected a string or number at ${path}.`); continue; }
      const text = String(found).trim();
      if (field === "severity") {
        const severity = mapping.severity_map?.[text.toLowerCase()] || text.toLowerCase();
        if (!severityValues.has(severity)) errors.push(`severity: ${text} is not a supported severity. Add it to severity_map.`);
        else output.severity = severity;
      } else output[field] = text;
    } else if (field === "insight_refs") {
      if (!Array.isArray(found) || found.some(item => typeof item !== "string")) errors.push(`insight_refs: expected an array of strings at ${path}.`);
      else output.insight_refs = [...new Set(found.map(item => (item as string).trim()).filter(Boolean))];
    } else if (field === "evidence") {
      if (!Array.isArray(found)) { errors.push(`evidence: expected an array at ${path}.`); continue; }
      const evidence: { type: string; value: string; label?: string }[] = [];
      found.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`evidence[${index}]: expected an object with type and value.`); return; }
        const record = item as Record<string, unknown>;
        if (typeof record.type !== "string" || !evidenceTypes.has(record.type) || (typeof record.value !== "string" && typeof record.value !== "number") || !String(record.value).trim()) { errors.push(`evidence[${index}]: expected a supported type and non-empty value.`); return; }
        evidence.push({ type: record.type, value: String(record.value).trim(), ...(typeof record.label === "string" ? { label: record.label } : {}) });
      });
      output.evidence = evidence;
    }
  }
  if (errors.length) return { errors };
  return { normalized: output as unknown as AlertInput, errors: [] };
}

export function requireValidMapping(value: unknown): AlertMapping {
  const result = checkMapping(value);
  if (!result.mapping) throw new ApiError(400, "INVALID_EVENT_MAPPING", result.errors.join(" "));
  return result.mapping;
}
