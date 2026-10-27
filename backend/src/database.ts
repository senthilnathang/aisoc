import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(db);
  seed(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investigations (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
      status TEXT NOT NULL CHECK (status IN ('open','investigating','contained','resolved','closed')),
      determination TEXT NOT NULL CHECK (determination IN ('unknown','benign','suspicious','malicious','mitigated')),
      risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
      owner TEXT NOT NULL DEFAULT '7AI Agent',
      primary_entity TEXT NOT NULL DEFAULT '',
      replay_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      investigation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, investigation_id) REFERENCES investigations(tenant_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS detection_rules (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      mitre_techniques_json TEXT NOT NULL DEFAULT '[]',
      execution_mode TEXT NOT NULL DEFAULT 'scheduled',
      enabled INTEGER NOT NULL DEFAULT 1,
      severity TEXT NOT NULL,
      detections INTEGER NOT NULL DEFAULT 0,
      investigations INTEGER NOT NULL DEFAULT 0,
      false_positive_rate REAL NOT NULL DEFAULT 0,
      recommendation_status TEXT NOT NULL DEFAULT 'not_analyzed',
      last_activity_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS hunts (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'ad_hoc',
      status TEXT NOT NULL DEFAULT 'draft',
      verdict TEXT,
      findings_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      workspace_url TEXT NOT NULL DEFAULT '',
      client_id TEXT NOT NULL DEFAULT '',
      secret_ciphertext TEXT NOT NULL DEFAULT '',
      config_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'untested',
      last_tested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS remediations (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      investigation_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      connector TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      executed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, investigation_id) REFERENCES investigations(tenant_id, id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_investigations_tenant_status ON investigations(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_remediations_investigation ON remediations(tenant_id, investigation_id);
    CREATE INDEX IF NOT EXISTS idx_rules_tenant_enabled ON detection_rules(tenant_id, enabled);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
  `);
}

function seed(db: DatabaseSync): void {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM investigations WHERE tenant_id = ?").get("demo") as { count: number };
  if (existing.count > 0) return;
  const now = new Date().toISOString();
  const insertInvestigation = db.prepare(`INSERT INTO investigations
    (id, tenant_id, title, summary, source, category, severity, status, determination, risk_score, owner, primary_entity, replay_count, created_at, updated_at)
    VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  const investigations = [
    ["INV-4821", "Suspicious OAuth consent grant", "OAuth app requested mailbox access.", "Microsoft 365", "identity", "critical", "investigating", "malicious", 94, "7AI Agent", "j.park@nova.example"],
    ["INV-4819", "Risk-Backed Impossible Travel - Entra ID", "Sign-ins from Philippines and Kazakhstan.", "Entra ID", "identity", "high", "contained", "malicious", 87, "Maya Chen", "maya.santos@okami-ai.com"],
    ["INV-4814", "Encoded PowerShell spawned by Excel", "Credential access followed by outbound transfer.", "CrowdStrike", "endpoint", "high", "investigating", "suspicious", 82, "7AI Agent", "OKAMI-FIN-074"],
    ["INV-4808", "Unusual S3 bulk object access", "Service account collected an unusual object volume.", "AWS GuardDuty", "cloud", "medium", "open", "unknown", 71, "Noah Reed", "svc-data-export"]
  ];
  for (const row of investigations) insertInvestigation.run(...row, now, now);

  const insertRule = db.prepare(`INSERT INTO detection_rules
    (id, tenant_id, name, description, mitre_techniques_json, execution_mode, enabled, severity, detections, investigations, false_positive_rate, recommendation_status, last_activity_at, created_at, updated_at)
    VALUES (?, 'demo', ?, '', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rules = [
    ["RULE-001", "7AI - CRXfiltrate Browser Domain and Path Match", '["T1567","T1071"]', "scheduled", "high", 837, 193, 26, "validated"],
    ["RULE-002", "7AI - Impossible Travel", '["T1078"]', "scheduled", "medium", 200, 170, 45, "not_analyzed"],
    ["RULE-003", "7AI - Suspicious PowerShell EncodedCommand", '["T1059.001"]', "scheduled", "high", 190, 153, 10, "validated"]
  ];
  for (const row of rules) insertRule.run(...row, now, now, now);

  const insertConnector = db.prepare(`INSERT INTO connectors
    (id, tenant_id, type, name, description, workspace_url, client_id, secret_ciphertext, config_json, status, last_tested_at, created_at, updated_at)
    VALUES (?, 'demo', ?, ?, ?, ?, ?, '', '{}', ?, ?, ?, ?)`);
  for (const row of [
    ["CON-001", "crowdstrike", "CrowdStrike Falcon", "Endpoint detection", "", "", "operational"],
    ["CON-002", "microsoft_sentinel", "Microsoft Sentinel", "SIEM and analytics", "", "", "operational"],
    ["CON-003", "cribl", "Production Cribl", "Log routing", "https://example.cribl.cloud", "local-client", "untested"]
  ]) insertConnector.run(...row, row[6] === "operational" ? now : null, now, now);

  const insertRemediation = db.prepare(`INSERT INTO remediations
    (id, tenant_id, investigation_id, action_type, title, description, connector, status, executed_at, created_at, updated_at)
    VALUES (?, 'demo', ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`);
  for (const row of [
    ["REM-001", "INV-4814", "revoke_sessions", "Revoke all active sessions", "Invalidate browser and refresh tokens.", "Microsoft Defender"],
    ["REM-002", "INV-4814", "isolate_device", "Quarantine Setu.exe on OKAMI-FIN-074", "Isolate endpoint and quarantine SHA-256.", "Microsoft Defender"]
  ]) insertRemediation.run(...row, now, now);
}
