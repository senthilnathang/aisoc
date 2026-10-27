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

    CREATE TABLE IF NOT EXISTS threat_intel_reports (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '7AI',
      report_type TEXT NOT NULL DEFAULT 'threat_report' CHECK (report_type IN ('threat_report','advisory','ioc_feed','hunt_pack')),
      severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','actionable','archived')),
      ioc_count INTEGER NOT NULL DEFAULT 0,
      hunt_status TEXT NOT NULL DEFAULT 'not_started' CHECK (hunt_status IN ('not_started','hunting','completed','no_findings')),
      hunts_launched INTEGER NOT NULL DEFAULT 0,
      findings_count INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS threat_indicators (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      indicator_type TEXT NOT NULL CHECK (indicator_type IN ('ip','domain','hash_sha256','hash_md5','url','email','cve')),
      value TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','mitigated','expired','false_positive')),
      hits INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, report_id) REFERENCES threat_intel_reports(tenant_id, id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_investigations_tenant_status ON investigations(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_remediations_investigation ON remediations(tenant_id, investigation_id);
    CREATE INDEX IF NOT EXISTS idx_rules_tenant_enabled ON detection_rules(tenant_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_threat_intel_tenant_status ON threat_intel_reports(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_indicators_report ON threat_indicators(tenant_id, report_id);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));
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

  const insertReport = db.prepare(`INSERT INTO threat_intel_reports
    (id, tenant_id, title, summary, source, report_type, severity, status, ioc_count, hunt_status, hunts_launched, findings_count, tags_json, published_at, created_at, updated_at)
    VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const reports: [string, string, string, string, string, string, string, number, string, number, number, string, string][] = [
    ["TIR-001", "CRXfiltrate — Remote-Controlled Manifest V3 Browser Extensions", "Backdoored Chrome extensions using Manifest V3 exfiltrate browser data through covert update channels.", "7AI Threat Intelligence", "threat_report", "critical", "actionable", 12, "completed", 2, 3, '["browser","extension","exfiltration"]', "2026-10-20T14:00:00Z"],
    ["TIR-002", "APT42 — Gov Phishing Wave", "Iranian state-sponsored group targeting government contractors with credential-harvesting campaigns.", "7AI Threat Intelligence", "advisory", "high", "actionable", 8, "completed", 1, 1, '["apt42","phishing","government"]', "2026-10-18T09:30:00Z"],
    ["TIR-003", "Click, Install, Compromise: The New Wave of Zoom-Themed Attacks", "Threat actors distributing trojanized Zoom installers through SEO-poisoned search results.", "Google Threat Intelligence", "threat_report", "high", "reviewing", 6, "hunting", 1, 0, '["zoom","trojan","seo-poisoning"]', "2026-10-22T11:15:00Z"],
    ["TIR-004", "UNC1549 — Aerospace Harvest", "Espionage cluster targeting aerospace and defense supply chain via compromised vendor portals.", "Google Threat Intelligence", "advisory", "medium", "archived", 4, "no_findings", 1, 0, '["unc1549","aerospace","supply-chain"]', "2026-10-10T08:00:00Z"],
    ["TIR-005", "Lumma Stealer C2 Infrastructure Update", "New Lumma Stealer command-and-control domains and IPs observed rotating across bulletproof hosting.", "7AI Threat Intelligence", "ioc_feed", "critical", "actionable", 15, "completed", 3, 5, '["lumma","stealer","c2"]', "2026-10-21T16:45:00Z"],
    ["TIR-006", "CVE-2026-42897 — Microsoft Exchange Server XSS / Spoofing Vulnerability", "Unauthenticated cross-site scripting allowing session hijack on OWA; public exploit available.", "NIST NVD", "advisory", "high", "new", 3, "not_started", 0, 0, '["cve","exchange","xss"]', "2026-10-23T12:00:00Z"],
    ["TIR-007", "Black Basta Ransomware TTPs — Q4 2026", "Updated playbook covering Black Basta initial access via QakBot, lateral movement, and double extortion.", "Mandiant", "hunt_pack", "critical", "reviewing", 9, "hunting", 2, 0, '["black-basta","ransomware","qakbot"]', "2026-10-19T10:00:00Z"],
    ["TIR-008", "Cobalt Strike Malleable C2 Profiles", "Newly observed Cobalt Strike profiles mimicking CDN and cloud API traffic patterns.", "Recorded Future", "ioc_feed", "high", "actionable", 11, "completed", 2, 2, '["cobalt-strike","c2","malleable"]', "2026-10-15T13:30:00Z"]
  ];
  for (const row of reports) insertReport.run(...row, now, now);

  const insertIndicator = db.prepare(`INSERT INTO threat_indicators
    (id, tenant_id, report_id, indicator_type, value, severity, status, hits, last_seen_at, created_at, updated_at)
    VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const indicators: [string, string, string, string, string, string, number, string | null][] = [
    ["IOC-001", "TIR-001", "domain", "crx-update.cloudgateway.cc", "critical", "active", 2, now],
    ["IOC-002", "TIR-001", "domain", "ext-telemetry.appcdn.services", "critical", "active", 1, now],
    ["IOC-003", "TIR-001", "hash_sha256", "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "high", "active", 3, now],
    ["IOC-004", "TIR-002", "domain", "gov-auth-portal.iranianhost.top", "high", "active", 0, null],
    ["IOC-005", "TIR-002", "ip", "185.220.101.45", "high", "active", 2, now],
    ["IOC-006", "TIR-003", "domain", "zoom-download-center.com", "high", "active", 0, null],
    ["IOC-007", "TIR-003", "hash_sha256", "f7e8d9c0b1a2f7e8d9c0b1a2f7e8d9c0b1a2f7e8d9c0b1a2f7e8d9c0b1a2f7e8", "high", "active", 0, null],
    ["IOC-008", "TIR-004", "ip", "103.224.182.250", "medium", "expired", 0, null],
    ["IOC-009", "TIR-005", "ip", "45.83.12.9", "critical", "active", 2, now],
    ["IOC-010", "TIR-005", "domain", "releases.cloudgateway.cc", "critical", "active", 1, now],
    ["IOC-011", "TIR-005", "hash_md5", "31fc9a2b7e4d8f1a0c6e3b9d5a7f2c8e", "high", "active", 1, now],
    ["IOC-012", "TIR-006", "cve", "CVE-2026-42897", "high", "active", 0, null],
    ["IOC-013", "TIR-007", "domain", "qakbot-c2-node.darkhost.xyz", "critical", "active", 0, null],
    ["IOC-014", "TIR-007", "ip", "194.36.189.72", "critical", "active", 0, null],
    ["IOC-015", "TIR-008", "ip", "104.21.79.237", "high", "active", 2, now],
    ["IOC-016", "TIR-008", "domain", "cdn-api-gateway.azureedge.cc", "high", "mitigated", 4, now]
  ];
  for (const row of indicators) insertIndicator.run(...row, now, now);
}
