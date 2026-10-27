import { randomUUID } from "node:crypto";
import type { Store } from "../repositories/store.js";
import type { ListOptions, ResourceRecord } from "../types/domain.js";

type ResourceName = "investigations" | "detection_rules" | "hunts" | "connectors" | "remediations" | "threat_intel_reports" | "threat_indicators";

const PREFIX: Record<ResourceName, string> = {
  investigations: "INV",
  detection_rules: "RULE",
  hunts: "HUNT",
  connectors: "CON",
  remediations: "REM",
  threat_intel_reports: "TIR",
  threat_indicators: "IOC"
};

export class PlatformService {
  constructor(private readonly store: Store) {}

  list(resource: ResourceName, tenantId: string, options?: ListOptions): ResourceRecord[] { return this.store.list(resource, tenantId, options); }
  get(resource: ResourceName, tenantId: string, id: string): ResourceRecord | undefined { return this.store.get(resource, tenantId, id); }
  create(resource: ResourceName, tenantId: string, data: Record<string, unknown>): ResourceRecord {
    return this.store.create(resource, tenantId, { id: data.id ?? `${PREFIX[resource]}-${randomUUID().slice(0, 8)}`, ...data });
  }
  update(resource: ResourceName, tenantId: string, id: string, data: Record<string, unknown>): ResourceRecord | undefined { return this.store.update(resource, tenantId, id, data); }
  delete(resource: ResourceName, tenantId: string, id: string): boolean { return this.store.delete(resource, tenantId, id); }

  investigationDetail(tenantId: string, id: string): Record<string, unknown> | undefined {
    const investigation = this.get("investigations", tenantId, id);
    if (!investigation) return undefined;
    return {
      ...investigation,
      artifacts: this.store.list("artifacts", tenantId, { investigationId: id }),
      remediations: this.list("remediations", tenantId, { investigationId: id })
    };
  }

  reinvestigate(tenantId: string, id: string): ResourceRecord | undefined {
    const current = this.get("investigations", tenantId, id);
    if (!current) return undefined;
    return this.update("investigations", tenantId, id, {
      status: "investigating",
      determination: "unknown",
      replay_count: Number(current.replay_count) + 1
    });
  }

  runHunt(tenantId: string, id: string): ResourceRecord | undefined {
    if (!this.get("hunts", tenantId, id)) return undefined;
    const findings = (id.length % 4) + 1;
    return this.update("hunts", tenantId, id, { status: "completed", verdict: findings > 1 ? "review_required" : "no_findings", findings_count: findings, last_run_at: new Date().toISOString() });
  }

  testConnector(tenantId: string, id: string): ResourceRecord | undefined {
    const connector = this.get("connectors", tenantId, id);
    if (!connector) return undefined;
    const operational = Boolean(connector.name) && (connector.type !== "cribl" || Boolean(connector.workspace_url && connector.client_id));
    return this.update("connectors", tenantId, id, { status: operational ? "operational" : "error", last_tested_at: new Date().toISOString() });
  }

  executeRemediation(tenantId: string, id: string): ResourceRecord | undefined {
    if (!this.get("remediations", tenantId, id)) return undefined;
    return this.update("remediations", tenantId, id, { status: "completed", executed_at: new Date().toISOString() });
  }

  dashboard(tenantId: string): Record<string, unknown> {
    return {
      queueItems: this.store.count("investigations", tenantId, "status NOT IN ('resolved','closed')"),
      openInvestigations: this.store.count("investigations", tenantId, "status IN ('open','investigating')"),
      openRemediations: this.store.count("remediations", tenantId, "status = 'pending'"),
      enabledDetectionRules: this.store.count("detection_rules", tenantId, "enabled = 1"),
      operationalConnectors: this.store.count("connectors", tenantId, "status = 'operational'"),
      recentInvestigations: this.list("investigations", tenantId, { limit: 5 })
    };
  }

  threatIntelDetail(tenantId: string, id: string): Record<string, unknown> | undefined {
    const report = this.get("threat_intel_reports", tenantId, id);
    if (!report) return undefined;
    return { ...report, indicators: this.store.list("threat_indicators", tenantId, { reportId: id }) };
  }

  launchThreatHunt(tenantId: string, id: string): ResourceRecord | undefined {
    const report = this.get("threat_intel_reports", tenantId, id);
    if (!report) return undefined;
    return this.update("threat_intel_reports", tenantId, id, {
      hunt_status: "hunting",
      hunts_launched: Number(report.hunts_launched) + 1
    });
  }

  threatIntelDashboard(tenantId: string): Record<string, unknown> {
    const reports = this.list("threat_intel_reports", tenantId, { limit: 500 });
    const indicators = this.list("threat_indicators", tenantId, { limit: 500 });
    const bySource: Record<string, number> = {};
    for (const r of reports) bySource[String(r.source)] = (bySource[String(r.source)] || 0) + 1;
    return {
      totalReports: reports.length,
      totalIndicators: indicators.length,
      indicatorsWithHits: indicators.filter((i) => Number(i.hits) > 0).length,
      activeHunts: reports.filter((r) => r.hunt_status === "hunting").length,
      findingsTotal: reports.reduce((sum, r) => sum + Number(r.findings_count), 0),
      reportsBySource: bySource,
      recentReports: reports.slice(0, 5)
    };
  }
}
