import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { equalTokenHash, tokenHash } from "../auth.js";
import { ApiError } from "../errors.js";
import type { Store } from "../repositories/store.js";
import type { ResourceRecord } from "../types/domain.js";
import { mapNativeEvent, requireValidMapping, type AlertMapping } from "./event-mapping.js";

interface SourceRow extends ResourceRecord {
  id: string; tenant_id: string; name: string; provider: string; rule_id: string;
  key_hash: string | null; mapping_json: string; expires_at: string; revoked_at: string | null; created_at: string; updated_at: string;
}
export class ApiSources {
  constructor(private readonly db: DatabaseSync, private readonly store: Store) {}
  private view(row: SourceRow) {
    const { key_hash: _hash, mapping_json: mappingJson, ...fields } = row;
    return { ...fields, mapping: JSON.parse(mappingJson || '{"fields":{}}'), status: row.revoked_at ? "revoked" : Date.parse(row.expires_at) <= Date.now() ? "expired" : "active", intake_path: `/api/v1/intake/${row.id}/alerts`, native_intake_path: `/api/v1/intake/${row.id}/events`, source: `api-source:${row.id}`, format: "normalized-alert-v1" };
  }
  private row(tenant: string, id: string) { return this.db.prepare("SELECT * FROM api_sources WHERE tenant_id = ? AND id = ?").get(tenant, id) as SourceRow | undefined; }
  list(tenant: string) { return (this.db.prepare("SELECT * FROM api_sources WHERE tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100").all(tenant) as SourceRow[]).map(row => this.view(row)); }
  get(tenant: string, id: string) { const row = this.row(tenant, id); return row ? this.view(row) : undefined; }
  updateMapping(tenant: string, id: string, value: unknown, actorId: string) {
    const current = this.row(tenant, id);
    if (!current) throw new ApiError(404, "NOT_FOUND", "API source not found");
    const mapping = requireValidMapping(value);
    this.store.transaction(() => {
      this.db.prepare("UPDATE api_sources SET mapping_json=?,updated_at=? WHERE tenant_id=? AND id=?").run(JSON.stringify(mapping), new Date().toISOString(), tenant, id);
      this.audit(tenant, id, "source_mapping_updated", actorId);
    });
    return this.get(tenant, id)!;
  }
  previewMapping(tenant: string, id: string, mapping: unknown, sample: unknown) {
    const source = this.row(tenant, id);
    if (!source) throw new ApiError(404, "NOT_FOUND", "API source not found");
    const result = mapNativeEvent(mapping, `api-source:${id}`, source.rule_id, sample);
    return { valid: Boolean(result.normalized), errors: result.errors, normalized_alert: result.normalized || null };
  }
  mapEvent(tenant: string, id: string, sample: unknown) {
    const source = this.row(tenant, id);
    if (!source) throw new ApiError(404, "NOT_FOUND", "API source not found");
    const mapping = JSON.parse(source.mapping_json || '{"fields":{}}') as AlertMapping;
    if (!Object.keys(mapping.fields || {}).length) throw new ApiError(409, "MAPPING_NOT_CONFIGURED", "Configure and save a valid event mapping before sending native events.");
    return mapNativeEvent(mapping, `api-source:${id}`, source.rule_id, sample);
  }
  authenticate(id: string, token: string): SourceRow | undefined {
    const row = this.db.prepare("SELECT * FROM api_sources WHERE id = ?").get(id) as SourceRow | undefined;
    if (!row || row.revoked_at || !row.key_hash || Date.parse(row.expires_at) <= Date.now() || !equalTokenHash(token, row.key_hash)) return undefined;
    return row;
  }
  private audit(tenant: string, id: string, action: string, actorId: string) {
    this.store.create("audit_events", tenant, { id: randomUUID(), resource: "api_sources", resource_id: id, action, details: { actor_id: actorId } });
  }
  create(tenant: string, data: { name: string; provider: string; rule_id: string; expires_in_days: number }, actorId: string) {
    return this.store.transaction(() => {
      if (!this.store.get("detection_rules", tenant, data.rule_id)) throw new ApiError(404, "NOT_FOUND", "Detection rule not found");
      const id = `SRC-${randomUUID()}`;
      const key = `aisoc_src_${randomBytes(32).toString("base64url")}`;
      const now = new Date().toISOString();
      const expiry = new Date(Date.now() + data.expires_in_days * 86400000).toISOString();
      this.db.prepare("INSERT INTO api_sources (id, tenant_id, name, provider, rule_id, key_hash, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, tenant, data.name.trim(), data.provider.trim(), data.rule_id, tokenHash(key), expiry, now, now);
      this.audit(tenant, id, "source_created", actorId);
      return { source: this.get(tenant, id)!, api_key: key };
    });
  }
  rotate(tenant: string, id: string, days: number, actorId: string) {
    return this.store.transaction(() => {
      if (!this.row(tenant, id)) throw new ApiError(404, "NOT_FOUND", "API source not found");
      const key = `aisoc_src_${randomBytes(32).toString("base64url")}`;
      this.db.prepare("UPDATE api_sources SET key_hash = ?, revoked_at = NULL, expires_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
        .run(tokenHash(key), new Date(Date.now() + days * 86400000).toISOString(), new Date().toISOString(), tenant, id);
      this.audit(tenant, id, "source_key_rotated", actorId);
      return { source: this.get(tenant, id)!, api_key: key };
    });
  }
  revoke(tenant: string, id: string, actorId: string) {
    return this.store.transaction(() => {
      const current = this.row(tenant, id);
      if (!current) throw new ApiError(404, "NOT_FOUND", "API source not found");
      if (!current.revoked_at) {
        const now = new Date().toISOString();
        this.db.prepare("UPDATE api_sources SET key_hash = NULL, revoked_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?").run(now, now, tenant, id);
        this.audit(tenant, id, "source_key_revoked", actorId);
      }
      return this.get(tenant, id)!;
    });
  }
}
