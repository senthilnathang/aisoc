import type { DatabaseSync } from "node:sqlite";

export function migratePipeline(db: DatabaseSync): void {
  db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 4").get()) {
      db.exec(`CREATE TABLE alerts (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, source TEXT NOT NULL, external_id TEXT NOT NULL,
        rule_id TEXT NOT NULL, investigation_id TEXT, title TEXT NOT NULL, severity TEXT NOT NULL,
        routing TEXT NOT NULL, disposition TEXT NOT NULL, payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, source, external_id),
        FOREIGN KEY (tenant_id, rule_id) REFERENCES detection_rules(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, investigation_id) REFERENCES investigations(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE investigation_jobs (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, investigation_id TEXT NOT NULL, alert_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
        phase INTEGER NOT NULL DEFAULT 0 CHECK (phase BETWEEN 0 AND 3),
        error TEXT, result_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, investigation_id) REFERENCES investigations(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, alert_id) REFERENCES alerts(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX idx_jobs_active ON investigation_jobs(tenant_id, investigation_id) WHERE status IN ('queued','running');
      CREATE INDEX idx_jobs_pending ON investigation_jobs(status, updated_at);
      CREATE INDEX idx_alerts_case ON alerts(tenant_id, investigation_id);
      CREATE INDEX idx_jobs_case ON investigation_jobs(tenant_id, investigation_id, created_at);
      INSERT INTO schema_migrations VALUES (4, datetime('now'));`);
    }
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 5").get()) db.exec(`CREATE TABLE api_sources (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL,
      rule_id TEXT NOT NULL, key_hash TEXT, expires_at TEXT NOT NULL, revoked_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id, rule_id) REFERENCES detection_rules(tenant_id, id) ON DELETE RESTRICT
    ); CREATE INDEX idx_sources_tenant ON api_sources(tenant_id, created_at); INSERT INTO schema_migrations VALUES (5, datetime('now'));`);
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 6").get()) db.exec(`CREATE TABLE detection_rule_versions (
      tenant_id TEXT NOT NULL, rule_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, rule_id, version),
      FOREIGN KEY (tenant_id, rule_id) REFERENCES detection_rules(tenant_id, id) ON DELETE CASCADE
    ); CREATE INDEX idx_alerts_rule ON alerts(tenant_id, rule_id, created_at); INSERT INTO schema_migrations VALUES (6, datetime('now'));`);
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 8").get()) db.exec(`CREATE TABLE skills (
      id TEXT NOT NULL, tenant_id TEXT NOT NULL, name TEXT NOT NULL, skill_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', apply_when TEXT NOT NULL DEFAULT '', content_markdown TEXT NOT NULL DEFAULT '',
      modules_json TEXT NOT NULL DEFAULT '[]', connectors_json TEXT NOT NULL DEFAULT '[]', alert_types_json TEXT NOT NULL DEFAULT '[]',
      alert_categories_json TEXT NOT NULL DEFAULT '[]', source_entities_json TEXT NOT NULL DEFAULT '[]', runtime_entities_json TEXT NOT NULL DEFAULT '[]',
      insight_refs_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', origin TEXT NOT NULL DEFAULT 'user',
      state TEXT NOT NULL DEFAULT 'draft', enabled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id), CHECK (skill_type IN ('strategy','content')), CHECK (state IN ('draft','published')), CHECK (enabled IN (0,1))
    ); CREATE INDEX idx_skills_tenant_updated ON skills(tenant_id, updated_at DESC); INSERT INTO schema_migrations VALUES (8, datetime('now'));`);
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 9").get()) db.exec(`CREATE TABLE skill_materials (
      id TEXT NOT NULL, tenant_id TEXT NOT NULL, skill_id TEXT NOT NULL, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('reference','checklist','example')),
      file_type TEXT NOT NULL CHECK (file_type IN ('markdown','text','json','csv','url')),
      source_url TEXT, content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id), FOREIGN KEY (tenant_id, skill_id) REFERENCES skills(tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX idx_skill_materials_parent ON skill_materials(tenant_id, skill_id, archived_at, name);
    CREATE TABLE skill_material_versions (
      tenant_id TEXT NOT NULL, material_id TEXT NOT NULL, version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, material_id, version),
      FOREIGN KEY (tenant_id, material_id) REFERENCES skill_materials(tenant_id, id) ON DELETE CASCADE
    ); INSERT INTO schema_migrations VALUES (9, datetime('now'));`);
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 10").get()) db.exec(`
      ALTER TABLE investigations ADD COLUMN insight_refs_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE hunts ADD COLUMN insight_refs_json TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE skill_suggestions (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, signature TEXT NOT NULL, name TEXT NOT NULL,
        explanation TEXT NOT NULL, source TEXT NOT NULL, category TEXT NOT NULL,
        case_count INTEGER NOT NULL, feedback_count INTEGER NOT NULL DEFAULT 0,
        sample_case_ids_json TEXT NOT NULL, draft_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
        accepted_skill_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, signature)
      );
      CREATE INDEX idx_skill_suggestions_status ON skill_suggestions(tenant_id, status, updated_at DESC);
      CREATE TABLE skill_applications (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, skill_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('investigation','hunt')), target_id TEXT NOT NULL,
        skill_version INTEGER NOT NULL, reason TEXT NOT NULL, snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, skill_id) REFERENCES skills(tenant_id, id) ON DELETE CASCADE
      );
      CREATE INDEX idx_skill_applications_target ON skill_applications(tenant_id, target_type, target_id, created_at DESC);
      CREATE TABLE skill_application_feedback (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, application_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('helpful','not_helpful')),
        comment TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, application_id, created_by),
        FOREIGN KEY (tenant_id, application_id) REFERENCES skill_applications(tenant_id, id) ON DELETE CASCADE
      );
      CREATE INDEX idx_skill_feedback_app ON skill_application_feedback(tenant_id, application_id);
      INSERT INTO schema_migrations VALUES (10, datetime('now'));
    `);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
