import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { ListOptions, ResourceRecord } from "../types/domain.js";

const JSON_FIELDS: Record<string, string[]> = {
  artifacts: ["metadata_json"],
  detection_rules: ["mitre_techniques_json"],
  connectors: ["config_json"]
};

const SECRET_FIELDS = new Set(["secret_ciphertext"]);
const MUTABLE_FIELDS: Record<string, Set<string>> = {
  investigations: new Set(["title", "summary", "source", "category", "severity", "status", "determination", "risk_score", "owner", "primary_entity", "replay_count"]),
  artifacts: new Set(["investigation_id", "type", "value", "label", "metadata"]),
  detection_rules: new Set(["name", "description", "mitre_techniques", "execution_mode", "enabled", "severity", "detections", "investigations", "false_positive_rate", "recommendation_status", "last_activity_at"]),
  hunts: new Set(["name", "query", "source", "status", "verdict", "findings_count", "last_run_at"]),
  connectors: new Set(["type", "name", "description", "workspace_url", "client_id", "secret", "config", "status", "last_tested_at"]),
  remediations: new Set(["investigation_id", "action_type", "title", "description", "connector", "status", "executed_at"])
};
const STATUS_TABLES = new Set(["investigations", "hunts", "connectors", "remediations"]);
const SEVERITY_TABLES = new Set(["investigations", "detection_rules"]);
const SEARCH_FIELDS: Record<string, string[]> = {
  investigations: ["title", "source", "primary_entity"],
  detection_rules: ["name", "description"],
  hunts: ["name", "query"],
  connectors: ["name", "description"],
  remediations: ["title", "description"]
};

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  list(table: string, tenantId: string, options: ListOptions = {}): ResourceRecord[] {
    const clauses = ["tenant_id = ?"];
    const params: SQLOutputValue[] = [tenantId];
    if (options.status && STATUS_TABLES.has(table)) { clauses.push("status = ?"); params.push(options.status); }
    if (options.severity && SEVERITY_TABLES.has(table)) { clauses.push("severity = ?"); params.push(options.severity); }
    if (options.investigationId && ["artifacts", "remediations"].includes(table)) { clauses.push("investigation_id = ?"); params.push(options.investigationId); }
    if (options.search) {
      const fields = SEARCH_FIELDS[table] ?? [];
      clauses.push(`(${fields.map((field) => `${field} LIKE ?`).join(" OR ")})`);
      const value = `%${options.search}%`;
      params.push(...fields.map(() => value));
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    const rows = this.db.prepare(`SELECT * FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as ResourceRecord[];
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

  close(): void { this.db.close(); }

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
