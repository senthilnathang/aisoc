import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../errors.js";
import { Store } from "../repositories/store.js";

const FIELDS = ["modules", "connectors", "alert_types", "alert_categories", "source_entities", "runtime_entities", "insight_refs", "tags"] as const;
const JSON_COLUMNS: Record<(typeof FIELDS)[number], string> = { modules: "modules_json", connectors: "connectors_json", alert_types: "alert_types_json", alert_categories: "alert_categories_json", source_entities: "source_entities_json", runtime_entities: "runtime_entities_json", insight_refs: "insight_refs_json", tags: "tags_json" };
type SkillInput = { name?: string; skill_type?: "strategy" | "content"; description?: string; apply_when?: string; content_markdown?: string; modules?: string[]; connectors?: string[]; alert_types?: string[]; alert_categories?: string[]; source_entities?: string[]; runtime_entities?: string[]; insight_refs?: string[]; tags?: string[] };
type MaterialInput = { name?: string; kind?: "reference" | "checklist" | "example"; filename?: string; source_url?: string; content?: string };
const MATERIAL_LIMIT = 128 * 1024;
const MATERIAL_EXTENSIONS: Record<string, string> = { md: "markdown", markdown: "markdown", txt: "text", json: "json", csv: "csv" };

export class Skills {
  constructor(private readonly db: DatabaseSync, private readonly store: Store) {}
  private shape(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...row, enabled: Boolean(row.enabled) };
    for (const field of FIELDS) { result[field] = JSON.parse(String(row[JSON_COLUMNS[field]] || "[]")); delete result[JSON_COLUMNS[field]]; }
    return result;
  }
  list(tenantId: string, options: { search?: string; state?: string; module?: string; limit?: number; offset?: number }) {
    const clauses = ["tenant_id = ?"], params: (string | number)[] = [tenantId];
    if (options.state === "draft" || options.state === "published") { clauses.push("state = ?"); params.push(options.state); }
    if (options.module) { clauses.push("EXISTS (SELECT 1 FROM json_each(skills.modules_json) WHERE value = ?)"); params.push(options.module); }
    if (options.search?.trim()) { clauses.push("(instr(lower(name), lower(?)) > 0 OR instr(lower(description), lower(?)) > 0 OR instr(lower(tags_json), lower(?)) > 0)"); params.push(options.search, options.search, options.search); }
    const where = clauses.join(" AND "); const limit = options.limit ?? 25, offset = options.offset ?? 0;
    const total = Number((this.db.prepare(`SELECT COUNT(*) n FROM skills WHERE ${where}`).get(...params) as { n: number }).n);
    const rows = this.db.prepare(`SELECT * FROM skills WHERE ${where} ORDER BY updated_at DESC, name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset) as Record<string, unknown>[];
    return { items: rows.map(row => this.shape(row)), total, limit, offset };
  }
  get(tenantId: string, id: string) {
    const row = this.db.prepare("SELECT * FROM skills WHERE tenant_id = ? AND id = ?").get(tenantId, id) as Record<string, unknown> | undefined;
    return row ? this.shape(row) : undefined;
  }
  private audit(tenantId: string, id: string, action: string, actor: string, details: Record<string, unknown>) {
    this.store.create("audit_events", tenantId, { id: randomUUID(), resource: "skill", resource_id: id, action, details: { actor, ...details } });
  }
  create(tenantId: string, input: SkillInput, actor: string, origin: "user" | "environment_generated" = "user") {
    if (!input.name?.trim()) throw new ApiError(400, "INVALID_SKILL", "Skill name is required.");
    const id = `SK-${randomUUID()}`, now = new Date().toISOString();
    const fields: Record<string, unknown> = { id, tenant_id: tenantId, name: input.name.trim(), skill_type: input.skill_type ?? "strategy", description: input.description ?? "", apply_when: input.apply_when ?? "", content_markdown: input.content_markdown ?? "", origin, state: "draft", enabled: 0, version: 1, created_by: actor, created_at: now, updated_at: now };
    for (const field of FIELDS) fields[JSON_COLUMNS[field]] = JSON.stringify(input[field] ?? []);
    this.store.transaction(() => { const cols = Object.keys(fields); this.db.prepare(`INSERT INTO skills (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map(k => fields[k] as string | number)); this.audit(tenantId, id, "created", actor, { state: "draft" }); });
    return this.get(tenantId, id)!;
  }
  update(tenantId: string, id: string, input: SkillInput, actor: string) {
    const current = this.get(tenantId, id); if (!current) return undefined;
    if (!["user", "environment_generated"].includes(String(current.origin))) throw new ApiError(403, "READ_ONLY_SKILL", "This skill cannot be edited.");
    const sets: string[] = ["version = version + 1", "updated_at = ?"], values: (string | number)[] = [new Date().toISOString()];
    for (const field of ["name", "skill_type", "description", "apply_when", "content_markdown"] as const) if (input[field] !== undefined) { sets.push(`${field} = ?`); values.push(String(input[field])); }
    for (const field of FIELDS) if (input[field] !== undefined) { sets.push(`${JSON_COLUMNS[field]} = ?`); values.push(JSON.stringify(input[field])); }
    values.push(tenantId, id);
    this.store.transaction(() => { this.db.prepare(`UPDATE skills SET ${sets.join(",")} WHERE tenant_id = ? AND id = ?`).run(...values); this.audit(tenantId, id, "updated", actor, { version: Number(current.version) + 1 }); });
    return this.get(tenantId, id);
  }
  publish(tenantId: string, id: string, actor: string) {
    const current = this.get(tenantId, id); if (!current) return undefined;
    this.store.transaction(() => { this.db.prepare("UPDATE skills SET state='published', enabled=1, version=version+1, updated_at=? WHERE tenant_id=? AND id=?").run(new Date().toISOString(), tenantId, id); this.audit(tenantId, id, "published", actor, { version: Number(current.version) + 1 }); });
    return this.get(tenantId, id);
  }
  toggle(tenantId: string, id: string, actor: string) {
    const current = this.get(tenantId, id); if (!current) return undefined;
    if (current.state !== "published") throw new ApiError(409, "SKILL_NOT_PUBLISHED", "Publish this skill before enabling it.");
    const enabled = !current.enabled;
    this.store.transaction(() => { this.db.prepare("UPDATE skills SET enabled=?, version=version+1, updated_at=? WHERE tenant_id=? AND id=?").run(Number(enabled), new Date().toISOString(), tenantId, id); this.audit(tenantId, id, enabled ? "enabled" : "disabled", actor, {}); });
    return this.get(tenantId, id);
  }
  delete(tenantId: string, id: string) { return Number(this.db.prepare("DELETE FROM skills WHERE tenant_id=? AND id=? AND origin IN ('user','environment_generated')").run(tenantId, id).changes) > 0; }
  history(tenantId: string, id: string) { return this.store.history(tenantId, "skill", id); }

  private materialShape(row: Record<string, unknown>): Record<string, unknown> {
    return { ...row, content: String(row.content ?? "") };
  }
  listMaterials(tenantId: string, skillId: string) {
    if (!this.get(tenantId, skillId)) return undefined;
    const rows = this.db.prepare("SELECT id, tenant_id, skill_id, name, kind, file_type, source_url, version, created_by, created_at, updated_at FROM skill_materials WHERE tenant_id=? AND skill_id=? AND archived_at IS NULL ORDER BY name COLLATE NOCASE").all(tenantId, skillId) as Record<string, unknown>[];
    return { items: rows };
  }
  getMaterial(tenantId: string, skillId: string, id: string) {
    const row = this.db.prepare("SELECT * FROM skill_materials WHERE tenant_id=? AND skill_id=? AND id=?").get(tenantId, skillId, id) as Record<string, unknown> | undefined;
    return row ? this.materialShape(row) : undefined;
  }
  private materialSnapshot(row: Record<string, unknown>, actor: string, createdAt: string) {
    const snapshot = { name: row.name, kind: row.kind, file_type: row.file_type, source_url: row.source_url, content: row.content };
    this.db.prepare("INSERT INTO skill_material_versions (tenant_id, material_id, version, snapshot_json, created_by, created_at) VALUES (?,?,?,?,?,?)").run(row.tenant_id as string, row.id as string, row.version as number, JSON.stringify(snapshot), actor, createdAt);
  }
  private bumpForMaterial(tenantId: string, skillId: string, id: string, action: string, actor: string, version: number) {
    this.db.prepare("UPDATE skills SET version=version+1, updated_at=? WHERE tenant_id=? AND id=?").run(new Date().toISOString(), tenantId, skillId);
    this.audit(tenantId, skillId, action, actor, { material_id: id, material_version: version });
  }
  createMaterial(tenantId: string, skillId: string, input: MaterialInput, actor: string) {
    const skill = this.get(tenantId, skillId); if (!skill) return undefined;
    if (!["user", "environment_generated"].includes(String(skill.origin))) throw new ApiError(403, "READ_ONLY_SKILL", "Materials cannot be added to this skill.");
    const name = String(input.name ?? input.filename ?? "").trim();
    if (!name || name.length > 180) throw new ApiError(400, "INVALID_MATERIAL", "Provide a material name of 1 to 180 characters.");
    const kind = input.kind ?? "reference";
    if (!["reference", "checklist", "example"].includes(kind)) throw new ApiError(400, "INVALID_MATERIAL_KIND", "Material kind must be reference, checklist, or example.");
    const sourceUrl = input.source_url?.trim() || null;
    let fileType: string, content = input.content ?? "";
    if (sourceUrl) {
      let parsed: URL; try { parsed = new URL(sourceUrl); } catch { throw new ApiError(400, "INVALID_MATERIAL_URL", "Reference URL must be a valid HTTPS link."); }
      if (parsed.protocol !== "https:") throw new ApiError(400, "INVALID_MATERIAL_URL", "Reference URL must use HTTPS.");
      if (content) throw new ApiError(400, "INVALID_MATERIAL", "A URL reference cannot also contain file content.");
      fileType = "url";
    } else {
      const filename = input.filename || name;
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      fileType = MATERIAL_EXTENSIONS[ext] || "";
      if (!fileType) throw new ApiError(400, "UNSUPPORTED_MATERIAL_TYPE", "Use a Markdown, TXT, JSON, or CSV file, or add an HTTPS URL reference.");
      if (!content.trim()) throw new ApiError(400, "EMPTY_MATERIAL", "The uploaded material is empty.");
      if (Buffer.byteLength(content, "utf8") > MATERIAL_LIMIT) throw new ApiError(413, "MATERIAL_TOO_LARGE", "Each material must be 128 KB or smaller.");
    }
    const id = `SM-${randomUUID()}`, now = new Date().toISOString();
    const row = { id, tenant_id: tenantId, skill_id: skillId, name, kind, file_type: fileType, source_url: sourceUrl, content, version: 1, archived_at: null, created_by: actor, created_at: now, updated_at: now };
    this.store.transaction(() => {
      const activeCount = Number((this.db.prepare("SELECT COUNT(*) n FROM skill_materials WHERE tenant_id=? AND skill_id=? AND archived_at IS NULL").get(tenantId, skillId) as { n: number }).n);
      if (activeCount >= 10) throw new ApiError(400, "MATERIAL_LIMIT_REACHED", "A skill can have at most 10 active materials.");
      this.db.prepare("INSERT INTO skill_materials (id,tenant_id,skill_id,name,kind,file_type,source_url,content,version,archived_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, tenantId, skillId, name, kind, fileType, sourceUrl, content, 1, null, actor, now, now);
      this.materialSnapshot(row, actor, now);
      this.bumpForMaterial(tenantId, skillId, id, "material_added", actor, 1);
    });
    return this.getMaterial(tenantId, skillId, id);
  }
  updateMaterial(tenantId: string, skillId: string, id: string, input: MaterialInput, actor: string) {
    const current = this.getMaterial(tenantId, skillId, id); if (!current || current.archived_at) return undefined;
    const skill = this.get(tenantId, skillId);
    if (!skill || !["user", "environment_generated"].includes(String(skill.origin))) throw new ApiError(403, "READ_ONLY_SKILL", "This material cannot be edited.");
    const name = input.name === undefined ? String(current.name) : input.name.trim();
    if (!name || name.length > 180) throw new ApiError(400, "INVALID_MATERIAL", "Provide a material name of 1 to 180 characters.");
    const kind = input.kind ?? String(current.kind);
    if (!["reference", "checklist", "example"].includes(kind)) throw new ApiError(400, "INVALID_MATERIAL_KIND", "Material kind must be reference, checklist, or example.");
    const content = input.content ?? String(current.content);
    const sourceUrl = input.source_url === undefined ? (current.source_url as string | null) : (input.source_url?.trim() || null);
    if (Buffer.byteLength(content, "utf8") > MATERIAL_LIMIT) throw new ApiError(413, "MATERIAL_TOO_LARGE", "Each material must be 128 KB or smaller.");
    if (sourceUrl) { let parsed: URL; try { parsed = new URL(sourceUrl); } catch { throw new ApiError(400, "INVALID_MATERIAL_URL", "Reference URL must be a valid HTTPS link."); } if (parsed.protocol !== "https:" || content) throw new ApiError(400, "INVALID_MATERIAL_URL", "Use an HTTPS link without file content."); }
    else if (!content.trim()) throw new ApiError(400, "EMPTY_MATERIAL", "Material content cannot be empty.");
    const version = Number(current.version) + 1, now = new Date().toISOString();
    const next = { ...current, name, kind, source_url: sourceUrl, content, version, updated_at: now };
    this.store.transaction(() => {
      this.db.prepare("UPDATE skill_materials SET name=?,kind=?,source_url=?,content=?,version=?,updated_at=? WHERE tenant_id=? AND skill_id=? AND id=?").run(name, kind, sourceUrl, content, version, now, tenantId, skillId, id);
      this.materialSnapshot(next, actor, now);
      this.bumpForMaterial(tenantId, skillId, id, "material_updated", actor, version);
    });
    return this.getMaterial(tenantId, skillId, id);
  }
  archiveMaterial(tenantId: string, skillId: string, id: string, actor: string) {
    const current = this.getMaterial(tenantId, skillId, id); if (!current || current.archived_at) return false;
    const now = new Date().toISOString();
    this.store.transaction(() => {
      this.db.prepare("UPDATE skill_materials SET archived_at=?,updated_at=? WHERE tenant_id=? AND skill_id=? AND id=?").run(now, now, tenantId, skillId, id);
      this.bumpForMaterial(tenantId, skillId, id, "material_archived", actor, Number(current.version));
    });
    return true;
  }
  materialVersions(tenantId: string, skillId: string, id: string) {
    if (!this.getMaterial(tenantId, skillId, id)) return undefined;
    return this.db.prepare("SELECT version,snapshot_json,created_by,created_at FROM skill_material_versions WHERE tenant_id=? AND material_id=? ORDER BY version DESC").all(tenantId, id).map((row: Record<string, unknown>) => ({ version: row.version, snapshot: JSON.parse(String(row.snapshot_json)), created_by: row.created_by, created_at: row.created_at }));
  }

  private suggestionShape(row: Record<string, unknown>) {
    return { ...row, sample_case_ids: JSON.parse(String(row.sample_case_ids_json)), draft: JSON.parse(String(row.draft_json)) };
  }
  listSuggestions(tenantId: string, status = "pending") {
    this.refreshSuggestions(tenantId);
    const rows = this.db.prepare("SELECT * FROM skill_suggestions WHERE tenant_id=? AND status=? ORDER BY case_count DESC, updated_at DESC").all(tenantId, status) as Record<string, unknown>[];
    return { items: rows.map(row => this.suggestionShape(row)), generated_from: "repeated closed/resolved cases with analyst determinations", minimum_cases: 2 };
  }
  private refreshSuggestions(tenantId: string) {
    const patterns = this.db.prepare(`SELECT COALESCE(src.provider,a.source) AS source, COALESCE(NULLIF(i.category,''),'other') AS category,
      COUNT(DISTINCT i.id) AS case_count, COUNT(DISTINCT f.id) AS feedback_count
      FROM alerts a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id
      LEFT JOIN api_sources src ON a.source='api-source:' || src.id
      LEFT JOIN investigation_feedback f ON f.tenant_id=i.tenant_id AND f.investigation_id=i.id
      WHERE i.tenant_id=? AND i.status IN ('closed','resolved') AND i.determination IN ('benign','suspicious','malicious','mitigated')
      GROUP BY COALESCE(src.provider,a.source), COALESCE(NULLIF(i.category,''),'other') HAVING COUNT(DISTINCT i.id)>=2`).all(tenantId) as { source: string; category: string; case_count: number; feedback_count: number }[];
    for (const pattern of patterns) {
      const samples = this.db.prepare(`SELECT DISTINCT i.id FROM alerts a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id
        LEFT JOIN api_sources src ON a.source='api-source:' || src.id
        WHERE i.tenant_id=? AND COALESCE(src.provider,a.source)=? AND COALESCE(NULLIF(i.category,''),'other')=?
        AND i.status IN ('closed','resolved') AND i.determination IN ('benign','suspicious','malicious','mitigated')
        ORDER BY i.updated_at DESC LIMIT 10`).all(tenantId, pattern.source, pattern.category).map((row: Record<string, unknown>) => String(row.id));
      const cases = samples.map(caseId => this.store.get("investigations", tenantId, caseId)).filter(Boolean) as Record<string, unknown>[];
      const firstCase = cases[0];
      const commonInsights = firstCase ? ((firstCase.insight_refs as string[]) || []).filter(ref => cases.every(c => ((c.insight_refs as string[]) || []).includes(ref))) : [];
      const name = `Review ${pattern.category} alerts from ${pattern.source}`.slice(0, 200);
      const explanation = `Pattern candidate from ${pattern.case_count} closed or resolved investigations with analyst determinations${pattern.feedback_count ? ` and ${pattern.feedback_count} analyst notes` : ""}. This is a deterministic draft from workspace records, not an AI conclusion or measured effectiveness claim.`;
      const draft = { name, skill_type: "strategy", description: `A starting workflow based on ${pattern.case_count} reviewed ${pattern.category} cases from ${pattern.source}. Verify each conclusion against current evidence.`, apply_when: `When an investigation is categorized as ${pattern.category} and comes from ${pattern.source}.`, content_markdown: `## Suggested review\n1. Compare the current evidence with the case context and source details.\n2. Review the supplied artifacts and investigation history.\n3. Record an evidence-backed determination; keep uncertainty explicit.\n4. Require analyst approval for containment or other response actions.\n\nGenerated from ${pattern.case_count} closed or resolved workspace cases. Review and edit these steps before publishing.`, modules: ["investigations"], connectors: [pattern.source], alert_categories: [pattern.category], insight_refs: commonInsights, tags: [pattern.category.toLowerCase(), pattern.source.toLowerCase()] };
      const id = `SG-${randomUUID()}`, now = new Date().toISOString(), signature = `${pattern.source.toLowerCase()}|${pattern.category.toLowerCase()}`;
      this.db.prepare(`INSERT INTO skill_suggestions (id,tenant_id,signature,name,explanation,source,category,case_count,feedback_count,sample_case_ids_json,draft_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(tenant_id,signature) DO UPDATE SET
        name=excluded.name,explanation=excluded.explanation,case_count=excluded.case_count,feedback_count=excluded.feedback_count,
        sample_case_ids_json=excluded.sample_case_ids_json,draft_json=excluded.draft_json,updated_at=excluded.updated_at
        WHERE skill_suggestions.status='pending'`).run(id, tenantId, signature, name, explanation, pattern.source, pattern.category, pattern.case_count, pattern.feedback_count, JSON.stringify(samples), JSON.stringify(draft), now, now);
    }
  }
  acceptSuggestion(tenantId: string, id: string, actor: string) {
    const row = this.db.prepare("SELECT * FROM skill_suggestions WHERE tenant_id=? AND id=?").get(tenantId, id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (row.status === "accepted" && row.accepted_skill_id) return { suggestion: this.suggestionShape(row), skill: this.get(tenantId, String(row.accepted_skill_id)) };
    if (row.status !== "pending") throw new ApiError(409, "SUGGESTION_NOT_PENDING", "This suggestion has already been dismissed.");
    const input = JSON.parse(String(row.draft_json)) as SkillInput;
    const skillId = `SK-${randomUUID()}`, now = new Date().toISOString();
    const fields: Record<string, unknown> = { id: skillId, tenant_id: tenantId, name: String(input.name || row.name), skill_type: input.skill_type ?? "strategy", description: input.description ?? "", apply_when: input.apply_when ?? "", content_markdown: input.content_markdown ?? "", origin: "environment_generated", state: "draft", enabled: 0, version: 1, created_by: actor, created_at: now, updated_at: now };
    for (const field of FIELDS) fields[JSON_COLUMNS[field]] = JSON.stringify(input[field] ?? []);
    this.store.transaction(() => {
      const current = this.db.prepare("SELECT status FROM skill_suggestions WHERE tenant_id=? AND id=?").get(tenantId, id) as { status: string } | undefined;
      if (!current || current.status !== "pending") throw new ApiError(409, "SUGGESTION_NOT_PENDING", "This suggestion has already been reviewed.");
      const columns = Object.keys(fields);
      this.db.prepare(`INSERT INTO skills (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map(key => fields[key] as string | number));
      this.audit(tenantId, skillId, "created", actor, { origin: "environment_generated", suggestion_id: id });
      this.db.prepare("UPDATE skill_suggestions SET status='accepted',accepted_skill_id=?,updated_at=? WHERE tenant_id=? AND id=?").run(skillId, now, tenantId, id);
      this.audit(tenantId, skillId, "created_from_suggestion", actor, { suggestion_id: id, case_count: row.case_count });
    });
    const skill = this.get(tenantId, skillId)!;
    const suggestion = this.db.prepare("SELECT * FROM skill_suggestions WHERE tenant_id=? AND id=?").get(tenantId, id) as Record<string, unknown>;
    return { suggestion: this.suggestionShape(suggestion), skill };
  }
  dismissSuggestion(tenantId: string, id: string, actor: string) {
    const row = this.db.prepare("SELECT status FROM skill_suggestions WHERE tenant_id=? AND id=?").get(tenantId, id) as { status: string } | undefined;
    if (!row) return undefined;
    this.store.transaction(() => {
      const current = this.db.prepare("SELECT status FROM skill_suggestions WHERE tenant_id=? AND id=?").get(tenantId, id) as { status: string } | undefined;
      if (!current || current.status !== "pending") throw new ApiError(409, "SUGGESTION_NOT_PENDING", "Only pending suggestions can be dismissed.");
      this.db.prepare("UPDATE skill_suggestions SET status='dismissed',updated_at=? WHERE tenant_id=? AND id=?").run(new Date().toISOString(), tenantId, id);
      this.audit(tenantId, id, "suggestion_dismissed", actor, {});
    });
    return this.suggestionShape(this.db.prepare("SELECT * FROM skill_suggestions WHERE tenant_id=? AND id=?").get(tenantId, id) as Record<string, unknown>);
  }

  private normalizeSource(tenantId: string, source: string) {
    const aliases = [source];
    const match = source.match(/^api-source:(.+)$/);
    if (match) {
      const row = this.db.prepare("SELECT provider FROM api_sources WHERE tenant_id=? AND id=?").get(tenantId, match[1]!) as { provider: string } | undefined;
      if (row?.provider) aliases.push(row.provider);
    }
    const connectors = this.db.prepare("SELECT name,type FROM connectors WHERE tenant_id=?").all(tenantId) as { name: string; type: string }[];
    for (const c of connectors) if (aliases.some(alias => [c.name, c.type].some(value => value.toLowerCase() === alias.toLowerCase()))) aliases.push(c.name, c.type);
    return [...new Set(aliases.map(value => value.toLowerCase()))];
  }
  private matches(skill: Record<string, unknown>, context: { module: string; source?: string; title?: string; category?: string; source_entities?: string[]; runtime_entities?: string[]; insight_refs?: string[] }) {
    const reasons: string[] = [];
    const scoped = (value: unknown) => Array.isArray(value) ? value.map(v => String(v).toLowerCase()) : [];
    const modules = scoped(skill.modules);
    if (modules.length && !modules.includes(context.module.toLowerCase())) return null;
    reasons.push(`module: ${context.module}`);
    const connectors = scoped(skill.connectors);
    if (connectors.length) {
      const sources = context.source ? this.normalizeSource(String(skill.tenant_id), context.source) : [];
      if (!connectors.some(value => sources.includes(value))) return null;
      reasons.push(`connector: ${context.source}`);
    }
    const categories = scoped(skill.alert_categories);
    if (categories.length) { const value = (context.category || "").toLowerCase(); if (!value || !categories.includes(value)) return null; reasons.push(`category: ${context.category}`); }
    const types = scoped(skill.alert_types);
    if (types.length) { const value = (context.title || "").toLowerCase(); const found = types.find(type => value.includes(type)); if (!found) return null; reasons.push(`alert type: ${found}`); }
    const sourceEntities = scoped(skill.source_entities);
    if (sourceEntities.length) { const values = (context.source_entities || []).map(value => value.toLowerCase()); const found = sourceEntities.filter(value => values.includes(value)); if (!found.length) return null; reasons.push(`source entity: ${found.join(", ")}`); }
    const runtimeEntities = scoped(skill.runtime_entities);
    if (runtimeEntities.length) { const values = (context.runtime_entities || []).map(value => value.toLowerCase()); const found = runtimeEntities.filter(value => values.includes(value)); if (!found.length) return null; reasons.push(`runtime entity: ${found.join(", ")}`); }
    const insightRefs = scoped(skill.insight_refs);
    if (insightRefs.length) { const values = (context.insight_refs || []).map(value => value.toLowerCase()); const found = insightRefs.filter(value => values.includes(value)); if (!found.length) return null; reasons.push(`enterprise context: ${found.join(", ")}`); }
    return reasons;
  }
  private activeSkills(tenantId: string) {
    const rows = this.db.prepare("SELECT * FROM skills WHERE tenant_id=? AND state='published' AND enabled=1 ORDER BY name COLLATE NOCASE").all(tenantId) as Record<string, unknown>[];
    return rows.map(row => this.shape(row));
  }
  private applicationSnapshot(tenantId: string, skill: Record<string, unknown>) {
    const materials = this.db.prepare("SELECT id,name,kind,file_type,source_url,content,version FROM skill_materials WHERE tenant_id=? AND skill_id=? AND archived_at IS NULL ORDER BY name COLLATE NOCASE").all(tenantId, String(skill.id));
    return { id: skill.id, name: skill.name, skill_type: skill.skill_type, version: skill.version, description: skill.description, apply_when: skill.apply_when, content_markdown: skill.content_markdown, modules: skill.modules, connectors: skill.connectors, alert_types: skill.alert_types, alert_categories: skill.alert_categories, source_entities: skill.source_entities, runtime_entities: skill.runtime_entities, insight_refs: skill.insight_refs, materials };
  }
  private persistApplications(tenantId: string, targetType: "investigation" | "hunt", targetId: string, module: string, context: { source?: string; title?: string; category?: string; source_entities?: string[]; runtime_entities?: string[]; insight_refs?: string[] }) {
    const applied: Record<string, unknown>[] = [];
    for (const skill of this.activeSkills(tenantId)) {
      const reasons = this.matches(skill, { ...context, module }); if (!reasons) continue;
      const exists = this.db.prepare("SELECT * FROM skill_applications WHERE tenant_id=? AND skill_id=? AND target_type=? AND target_id=? AND skill_version=? ORDER BY created_at DESC LIMIT 1").get(tenantId, String(skill.id), targetType, targetId, Number(skill.version)) as Record<string, unknown> | undefined;
      if (exists) { applied.push({ id: exists.id, skill_id: skill.id, name: skill.name, version: skill.version, reason: exists.reason, already_applied: true }); continue; }
      const id = `SAP-${randomUUID()}`, now = new Date().toISOString(), reason = `Matched ${reasons.join("; ")}.`;
      const snapshot = this.applicationSnapshot(tenantId, skill);
      this.db.prepare("INSERT INTO skill_applications (id,tenant_id,skill_id,target_type,target_id,skill_version,reason,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, tenantId, String(skill.id), targetType, targetId, Number(skill.version), reason, JSON.stringify(snapshot), now);
      if (targetType === "investigation") {
        this.store.create("investigation_steps", tenantId, { id: `STEP-${id}`, investigation_id: targetId, title: `Applied skill: ${String(skill.name)}`, conclusion: reason, tool: "AISOC Skills", request: { skill_id: skill.id, skill_version: skill.version, reason, instructions: skill.content_markdown, materials: snapshot.materials, enterprise_context: skill.insight_refs }, response: { guidance_recorded: true, automated_actions: false, external_tools_executed: false } });
        this.store.create("audit_events", tenantId, { id: randomUUID(), resource: "investigations", resource_id: targetId, action: "skill_applied", details: { application_id: id, skill_id: skill.id, skill_version: skill.version, reason } });
      }
      applied.push({ id, skill_id: skill.id, name: skill.name, version: skill.version, reason });
    }
    return applied;
  }
  applyToInvestigation(tenantId: string, targetId: string, context: { source?: string; title?: string; category?: string; source_entities?: string[]; runtime_entities?: string[]; insight_refs?: string[] }) {
    return this.persistApplications(tenantId, "investigation", targetId, "investigations", context);
  }
  applyToHunt(tenantId: string, targetId: string, hunt: Record<string, unknown>) {
    return this.persistApplications(tenantId, "hunt", targetId, "hunting", { source: String(hunt.source || ""), title: `${hunt.name || ""} ${hunt.query || ""}`, category: String(hunt.category || ""), source_entities: [String(hunt.query || "")], runtime_entities: [], insight_refs: (hunt.insight_refs as string[]) || [] });
  }
  applications(tenantId: string, targetType: "investigation" | "hunt", targetId: string) {
    const rows = this.db.prepare("SELECT a.* FROM skill_applications a WHERE a.tenant_id=? AND a.target_type=? AND a.target_id=? ORDER BY a.created_at DESC").all(tenantId, targetType, targetId) as Record<string, unknown>[];
    return rows.map(row => ({ ...row, snapshot: JSON.parse(String(row.snapshot_json)), feedback: this.db.prepare("SELECT rating,comment,created_by,created_at,updated_at FROM skill_application_feedback WHERE tenant_id=? AND application_id=? ORDER BY updated_at DESC").all(tenantId, String(row.id)) }));
  }
  submitApplicationFeedback(tenantId: string, applicationId: string, input: { rating: "helpful" | "not_helpful"; comment?: string }, actor: string) {
    const application = this.db.prepare("SELECT id,skill_id FROM skill_applications WHERE tenant_id=? AND id=?").get(tenantId, applicationId) as { id: string; skill_id: string } | undefined;
    if (!application) throw new ApiError(404, "NOT_FOUND", "Skill application not found");
    const now = new Date().toISOString(), comment = input.comment?.trim() || "";
    this.store.transaction(() => {
      this.db.prepare(`INSERT INTO skill_application_feedback (id,tenant_id,application_id,rating,comment,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,application_id,created_by) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,updated_at=excluded.updated_at`)
        .run(randomUUID(), tenantId, applicationId, input.rating, comment, actor, now, now);
      this.audit(tenantId, application.skill_id, "application_feedback_received", actor, { application_id: applicationId, rating: input.rating });
    });
    return { application_id: applicationId, rating: input.rating, comment, updated_at: now };
  }
  outcomes(tenantId: string) {
    const skills = this.db.prepare("SELECT id,name,skill_type,state,version FROM skills WHERE tenant_id=? ORDER BY name COLLATE NOCASE").all(tenantId) as Record<string, unknown>[];
    const items = skills.map(skill => {
      const applications = this.db.prepare("SELECT target_type,COUNT(*) count,COUNT(DISTINCT target_id) targets FROM skill_applications WHERE tenant_id=? AND skill_id=? GROUP BY target_type").all(tenantId, String(skill.id)) as { target_type: string; count: number; targets: number }[];
      const feedback = this.db.prepare("SELECT rating,COUNT(*) count FROM skill_application_feedback f JOIN skill_applications a ON a.tenant_id=f.tenant_id AND a.id=f.application_id WHERE f.tenant_id=? AND a.skill_id=? GROUP BY rating").all(tenantId, String(skill.id)) as { rating: string; count: number }[];
      const labels = this.db.prepare(`SELECT i.determination AS label,COUNT(DISTINCT i.id) AS count FROM skill_applications a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.target_id
        WHERE a.tenant_id=? AND a.skill_id=? AND a.target_type='investigation' AND i.status IN ('closed','resolved') AND i.determination IN ('benign','suspicious','malicious','mitigated') GROUP BY i.determination`).all(tenantId, String(skill.id)) as { label: string; count: number }[];
      const count = (key: string, rows: { [key: string]: string | number }[], field: string) => Number(rows.find(row => row[field] === key)?.count || 0);
      const targets = (key: string) => Number(applications.find(row => row.target_type === key)?.targets || 0);
      return { ...skill, applications: applications.reduce((sum, row) => sum + row.count, 0), case_applications: targets("investigation"), hunt_applications: targets("hunt"), analyst_feedback: feedback.reduce((sum, row) => sum + row.count, 0), helpful: count("helpful", feedback, "rating"), not_helpful: count("not_helpful", feedback, "rating"), labeled_closed_cases: labels.reduce((sum, row) => sum + row.count, 0), outcomes: labels };
    });
    return { items, provenance: "Workspace application records, analyst ratings, and closed/resolved case determinations. Sample counts are shown; no causal improvement is inferred." };
  }
}
