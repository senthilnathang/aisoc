import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { ListOptions, ResourceRecord } from "../types/domain.js";

const JSON_FIELDS: Record<string, string[]> = {
  artifacts: ["metadata_json"],
  investigation_steps: ["request_json", "response_json"],
  audit_events: ["details_json"],
  detection_rules: ["mitre_techniques_json"],
  connectors: ["config_json"],
  threat_intel_reports: ["tags_json"],
  investigations: ["insight_refs_json"], hunts: ["insight_refs_json"]
};

const SECRET_FIELDS = new Set(["secret_ciphertext"]);
export const RULE_FIELDS = ["name", "description", "mitre_techniques", "execution_mode", "enabled", "severity", "query", "schedule", "lookback_window", "routing"];
export interface RegistryOptions { search?: string; severity?: string; enabled?: string; source?: string; sort?: string; direction?: string; limit?: number; offset?: number }
const MUTABLE_FIELDS: Record<string, Set<string>> = {
  investigation_steps: new Set(["investigation_id", "title", "conclusion", "tool", "request", "response"]),
  investigation_feedback: new Set(["investigation_id", "comment"]),
  audit_events: new Set(["resource", "resource_id", "action", "details"]),
  investigations: new Set(["title", "summary", "source", "category", "severity", "status", "determination", "risk_score", "owner", "primary_entity", "replay_count", "insight_refs"]),
  artifacts: new Set(["investigation_id", "type", "value", "label", "metadata"]),
  detection_rules: new Set(["name", "description", "mitre_techniques", "execution_mode", "enabled", "severity", "detections", "investigations", "false_positive_rate", "recommendation_status", "last_activity_at", "query", "schedule", "lookback_window", "routing"]),
  hunts: new Set(["name", "query", "source", "status", "verdict", "findings_count", "last_run_at", "insight_refs"]),
  connectors: new Set(["type", "name", "description", "workspace_url", "client_id", "secret", "config", "status", "last_tested_at"]),
  remediations: new Set(["investigation_id", "action_type", "title", "description", "connector", "status", "executed_at"]),
  threat_intel_reports: new Set(["title", "summary", "source", "report_type", "severity", "status", "ioc_count", "hunt_status", "hunts_launched", "findings_count", "tags", "published_at"]),
  threat_indicators: new Set(["report_id", "indicator_type", "value", "severity", "status", "hits", "last_seen_at"])
};
const STATUS_TABLES = new Set(["investigations", "hunts", "connectors", "remediations", "threat_intel_reports", "threat_indicators"]);
const SEVERITY_TABLES = new Set(["investigations", "detection_rules", "threat_intel_reports", "threat_indicators"]);
const SEARCH_FIELDS: Record<string, string[]> = {
  investigations: ["title", "source", "primary_entity"],
  detection_rules: ["name", "description"],
  hunts: ["name", "query"],
  connectors: ["name", "description"],
  remediations: ["title", "description"],
  threat_intel_reports: ["title", "summary", "source"],
  threat_indicators: ["value", "indicator_type"]
};

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  list(table: string, tenantId: string, options: ListOptions = {}): ResourceRecord[] {
    const clauses = ["tenant_id = ?"];
    const params: SQLOutputValue[] = [tenantId];
    if (options.status && STATUS_TABLES.has(table)) { clauses.push("status = ?"); params.push(options.status); }
    if (options.severity && SEVERITY_TABLES.has(table)) { clauses.push("severity = ?"); params.push(options.severity); }
    if (options.investigationId && ["artifacts", "remediations", "investigation_steps", "investigation_feedback"].includes(table)) { clauses.push("investigation_id = ?"); params.push(options.investigationId); }
    if (options.reportId && table === "threat_indicators") { clauses.push("report_id = ?"); params.push(options.reportId); }
    if (options.search) {
      const fields = SEARCH_FIELDS[table] ?? [];
      clauses.push(`(${fields.map((field) => `${field} LIKE ?`).join(" OR ")})`);
      const value = `%${options.search}%`;
      params.push(...fields.map(() => value));
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    const order = table === "investigation_steps" ? "created_at ASC, rowid ASC" : "updated_at DESC";
    const rows = this.db.prepare(`SELECT * FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as ResourceRecord[];
    return rows.map((row) => this.hydrate(table, row));
  }

  get(table: string, tenantId: string, id: string): ResourceRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`).get(tenantId, id) as ResourceRecord | undefined;
    return row ? this.hydrate(table, row) : undefined;
  }

  create(table: string, tenantId: string, data: Record<string, unknown>): ResourceRecord {
    const now = new Date().toISOString();
    const fields = Object.fromEntries(Object.entries(data).filter(([key]) => key === "id" || MUTABLE_FIELDS[table]?.has(key)));
    const record = this.dehydrate(table, { ...fields, tenant_id: tenantId, created_at: now, updated_at: now });
    const columns = Object.keys(record);
    this.db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((key) => record[key] as SQLOutputValue));
    return this.get(table, tenantId, String(data.id))!;
  }

  update(table: string, tenantId: string, id: string, data: Record<string, unknown>): ResourceRecord | undefined {
    const allowed = Object.entries(data).filter(([key, value]) => MUTABLE_FIELDS[table]?.has(key) && value !== undefined);
    if (allowed.length === 0) return this.get(table, tenantId, id);
    const normalized = this.dehydrate(table, Object.fromEntries(allowed));
    normalized.updated_at = new Date().toISOString();
    const entries = Object.entries(normalized);
    this.db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE tenant_id = ? AND id = ?`).run(...entries.map(([, value]) => value as SQLOutputValue), tenantId, id);
    return this.get(table, tenantId, id);
  }

  delete(table: string, tenantId: string, id: string): boolean {
    return Number(this.db.prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND id = ?`).run(tenantId, id).changes) > 0;
  }

  count(table: string, tenantId: string, where = "1=1"): number {
    const result = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND ${where}`).get(tenantId) as { count: number };
    return result.count;
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  history(tenantId: string, resource: string, id: string): ResourceRecord[] {
    return (this.db.prepare("SELECT * FROM audit_events WHERE tenant_id = ? AND resource = ? AND resource_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100").all(tenantId, resource, id) as ResourceRecord[]).map(row => this.hydrate("audit_events", row));
  }

  close(): void { this.db.close(); }

  ruleVersion(tenantId: string, id: string): number {
    return Number((this.db.prepare("SELECT COALESCE(MAX(version), 1) AS version FROM detection_rule_versions WHERE tenant_id = ? AND rule_id = ?").get(tenantId, id) as { version: number }).version);
  }

  snapshotRule(rule: ResourceRecord, version: number): void {
    const snapshot = Object.fromEntries(RULE_FIELDS.map(key => [key, rule[key]]));
    this.db.prepare("INSERT OR IGNORE INTO detection_rule_versions VALUES (?, ?, ?, ?, ?)").run(rule.tenant_id, rule.id, version, JSON.stringify(snapshot), new Date().toISOString());
  }

  ruleVersions(tenantId: string, id: string): unknown[] {
    const rows = this.db.prepare("SELECT version, snapshot_json, created_at FROM detection_rule_versions WHERE tenant_id = ? AND rule_id = ? ORDER BY version DESC").all(tenantId, id);
    if (!rows.length) {
      const rule = this.get("detection_rules", tenantId, id)!;
      return [{ version: 1, created_at: rule.updated_at, snapshot: Object.fromEntries(RULE_FIELDS.map(key => [key, rule[key]])) }];
    }
    return rows.map(row => ({ version: row.version, created_at: row.created_at, snapshot: JSON.parse(String(row.snapshot_json)) }));
  }

  ruleMetrics(tenantId: string, id: string): Record<string, unknown> {
    const counts = this.db.prepare(`SELECT COUNT(*) AS detections, COUNT(DISTINCT investigation_id) AS investigations,
      MAX(created_at) AS last_activity_at, SUM(CASE WHEN disposition = 'suppressed' THEN 1 ELSE 0 END) AS suppressed
      FROM alerts WHERE tenant_id = ? AND rule_id = ?`).get(tenantId, id)!;
    const outcomes = this.db.prepare(`SELECT i.determination, COUNT(DISTINCT i.id) AS count FROM alerts a
      JOIN investigations i ON i.tenant_id = a.tenant_id AND i.id = a.investigation_id
      WHERE a.tenant_id = ? AND a.rule_id = ? GROUP BY i.determination`).all(tenantId, id);
    const sources = this.db.prepare(`SELECT DISTINCT source FROM alerts WHERE tenant_id = ? AND rule_id = ? ORDER BY source`).all(tenantId, id).map(row => row.source);
    const bindings = this.db.prepare("SELECT id, name, provider FROM api_sources WHERE tenant_id = ? AND rule_id = ? ORDER BY name").all(tenantId, id);
    return { ...counts, suppressed: counts.suppressed || 0, false_positive_rate: null, outcomes, sources, bindings, period: "all_time" };
  }

  ruleRegistry(tenantId: string, options: RegistryOptions = {}): Record<string, unknown> {
    const clauses = ["r.tenant_id = ?"], params: SQLOutputValue[] = [tenantId];
    if (options.search) { clauses.push("(instr(lower(r.name), lower(?)) > 0 OR instr(lower(r.id), lower(?)) > 0 OR instr(lower(r.description), lower(?)) > 0)"); params.push(options.search, options.search, options.search); }
    if (options.severity) { clauses.push("r.severity = ?"); params.push(options.severity); }
    if (options.enabled) { clauses.push("r.enabled = ?"); params.push(options.enabled === "true" ? 1 : 0); }
    if (options.source) {
      clauses.push(`(EXISTS (SELECT 1 FROM alerts a WHERE a.tenant_id = r.tenant_id AND a.rule_id = r.id AND a.source = ?)
        OR EXISTS (SELECT 1 FROM api_sources s WHERE s.tenant_id = r.tenant_id AND s.rule_id = r.id AND s.provider = ?))`);
      params.push(options.source, options.source);
    }
    const where = clauses.join(" AND ");
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM detection_rules r WHERE ${where}`).get(...params)!.n);
    const orders: Record<string, string> = { name: "r.name COLLATE NOCASE", updated_at: "r.updated_at", severity: "CASE r.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END", detections: "actual_detections" };
    const limit = options.limit ?? 25, offset = options.offset ?? 0;
    const rows = this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM alerts a WHERE a.tenant_id = r.tenant_id AND a.rule_id = r.id) AS actual_detections
      FROM detection_rules r WHERE ${where} ORDER BY ${orders[options.sort || "updated_at"] || orders.updated_at} ${options.direction === "asc" ? "ASC" : "DESC"}, r.id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset) as ResourceRecord[];
    const items = rows.map(row => { const rule = this.hydrate("detection_rules", row); delete rule.actual_detections; return { ...rule, ...this.ruleMetrics(tenantId, rule.id), version: this.ruleVersion(tenantId, rule.id) }; });
    const sourceOptions = this.db.prepare("SELECT source AS value FROM alerts WHERE tenant_id = ? UNION SELECT provider AS value FROM api_sources WHERE tenant_id = ? ORDER BY value").all(tenantId, tenantId).map(row => row.value);
    return { items, total, limit, offset, sources: sourceOptions };
  }

  detectionIntelligence(tenantId: string, days: number, source?: string, severity?: string): Record<string, unknown> {
    const clauses = ["a.tenant_id = ?", "julianday(a.created_at) >= julianday('now', ?)"];
    const params: SQLOutputValue[] = [tenantId, `-${days} days`];
    if (source) { clauses.push("(a.source = ? OR s.provider = ?)"); params.push(source, source); }
    if (severity) { clauses.push("a.severity = ?"); params.push(severity); }
    const where = clauses.join(" AND ");
    const one = (sql: string) => this.db.prepare(sql.replace("/*where*/", where)).get(...params) as Record<string, number>;
    const many = (sql: string) => this.db.prepare(sql.replace("/*where*/", where)).all(...params) as Record<string, unknown>[];
    const totals = one(`SELECT COUNT(*) AS total_alerts,
      COUNT(DISTINCT a.investigation_id) AS investigated,
      SUM(CASE WHEN a.disposition = 'suppressed' THEN 1 ELSE 0 END) AS suppressed,
      SUM(CASE WHEN a.disposition = 'not_sampled' THEN 1 ELSE 0 END) AS not_sampled,
      COUNT(DISTINCT CASE WHEN i.determination = 'unknown' THEN a.investigation_id END) AS pending_review
      FROM alerts a LEFT JOIN investigations i ON i.tenant_id = a.tenant_id AND i.id = a.investigation_id
      LEFT JOIN api_sources s ON a.source = 'api-source:' || s.id WHERE /*where*/`);
    const groups = (field: string) => {
      const expression = field === "source" ? "COALESCE(s.provider, a.source)" : `a.${field}`;
      return many(`SELECT ${expression} AS name, COUNT(*) AS count FROM alerts a
        LEFT JOIN api_sources s ON a.source = 'api-source:' || s.id WHERE /*where*/ GROUP BY ${expression} ORDER BY count DESC, name ASC`);
    };
    const daily = many(`SELECT date(a.created_at) AS date,
      SUM(CASE WHEN a.severity = 'critical' THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN a.severity = 'high' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN a.severity = 'medium' THEN 1 ELSE 0 END) AS medium,
      SUM(CASE WHEN a.severity = 'low' THEN 1 ELSE 0 END) AS low,
      COUNT(*) AS total FROM alerts a LEFT JOIN api_sources s ON a.source = 'api-source:' || s.id WHERE /*where*/ GROUP BY date(a.created_at) ORDER BY date ASC`);
    const recent = many(`SELECT a.id, a.title, a.source, a.severity, a.disposition, a.routing, a.rule_id, a.investigation_id, a.created_at,
      r.name AS rule_name, s.provider AS source_provider, i.determination FROM alerts a JOIN detection_rules r ON r.tenant_id = a.tenant_id AND r.id = a.rule_id
      LEFT JOIN investigations i ON i.tenant_id = a.tenant_id AND i.id = a.investigation_id
      LEFT JOIN api_sources s ON a.source = 'api-source:' || s.id WHERE /*where*/ ORDER BY a.created_at DESC LIMIT 50`);
    const outcomes = many(`SELECT i.determination AS name, COUNT(DISTINCT i.id) AS count FROM alerts a
      JOIN investigations i ON i.tenant_id = a.tenant_id AND i.id = a.investigation_id
      LEFT JOIN api_sources s ON a.source = 'api-source:' || s.id WHERE /*where*/ GROUP BY i.determination ORDER BY count DESC`);
    const sourceChoices = this.db.prepare("SELECT source AS name FROM alerts WHERE tenant_id = ? AND source NOT LIKE 'api-source:%' UNION SELECT provider AS name FROM api_sources WHERE tenant_id = ? ORDER BY name").all(tenantId, tenantId).map(row => row.name);
    return { days, totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value || 0])), by_source: groups("source"), by_severity: groups("severity"), by_routing: groups("routing"), by_disposition: groups("disposition"), outcomes, daily, recent, sources: sourceChoices };
  }

  private hydrate(table: string, row: ResourceRecord): ResourceRecord {
    const result = { ...row };
    for (const field of JSON_FIELDS[table] ?? []) {
      if (typeof result[field] === "string") result[field.replace(/_json$/, "")] = JSON.parse(result[field] as string);
      delete result[field];
    }
    for (const field of SECRET_FIELDS) delete result[field];
    if (table === "detection_rules") result.enabled = Boolean(result.enabled);
    return result;
  }

  private dehydrate(table: string, data: Record<string, unknown>): Record<string, unknown> {
    const result = { ...data };
    for (const field of JSON_FIELDS[table] ?? []) {
      const apiField = field.replace(/_json$/, "");
      if (apiField in result) { result[field] = JSON.stringify(result[apiField]); delete result[apiField]; }
    }
    if (table === "detection_rules" && "enabled" in result) result.enabled = result.enabled ? 1 : 0;
    if (table === "connectors" && "secret" in result) { result.secret_ciphertext = String(result.secret); delete result.secret; }
    return result;
  }
}
