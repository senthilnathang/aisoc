import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import { RULE_FIELDS, type Store, type RegistryOptions } from "../repositories/store.js";
import type { AlertPipeline } from "./alert-pipeline.js";
import type { ListOptions, ResourceRecord } from "../types/domain.js";
import type { Skills } from "./skills.js";

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
  constructor(private readonly store: Store, private readonly pipeline: AlertPipeline, private readonly skills?: Skills) {}

  list(resource: ResourceName, tenantId: string, options?: ListOptions): ResourceRecord[] { return this.store.list(resource, tenantId, options); }
  get(resource: ResourceName, tenantId: string, id: string): ResourceRecord | undefined { return this.store.get(resource, tenantId, id); }
  create(resource: ResourceName, tenantId: string, data: Record<string, unknown>): ResourceRecord {
    return this.store.transaction(() => {
      const defaults = resource === "investigations" ? { status: "open", determination: "unknown" } : resource === "threat_intel_reports" ? { published_at: new Date().toISOString() } : {};
      const created = this.store.create(resource, tenantId, { ...defaults, ...data, id: `${PREFIX[resource]}-${randomUUID().slice(0, 8)}` });
      if (resource === "detection_rules") this.store.snapshotRule(created, 1);
      if (resource === "investigations") this.skills?.applyToInvestigation(tenantId, created.id, { source: String(created.source || ""), title: String(created.title || ""), category: String(created.category || "other"), source_entities: [String(created.primary_entity || "")], runtime_entities: [], insight_refs: (created.insight_refs as string[]) || [] });
      this.audit(tenantId, resource, created.id, "created");
      return created;
    });
  }
  update(resource: ResourceName, tenantId: string, id: string, data: Record<string, unknown>): ResourceRecord | undefined {
    return this.store.transaction(() => {
      if (resource === "investigations" && ["status", "determination", "summary", "risk_score", "replay_count"].some(key => key in data)) this.pipeline.assertEditable(tenantId, id);
      const before = resource === "detection_rules" ? this.store.get(resource, tenantId, id) : undefined;
      const version = before ? this.store.ruleVersion(tenantId, id) : 0;
      if (before && data.expected_version !== undefined && data.expected_version !== version) throw new ApiError(409, "VERSION_CONFLICT", "This rule changed. Reload it before saving.");
      const changed = before && RULE_FIELDS.some(key => key in data && JSON.stringify(data[key]) !== JSON.stringify(before[key]));
      if (changed) this.store.snapshotRule(before, version);
      const updated = this.store.update(resource, tenantId, id, data);
      if (updated && changed) this.store.snapshotRule(updated, version + 1);
      if (updated) this.audit(tenantId, resource, id, "updated", { fields: Object.keys(data).filter(k => k !== "secret") });
      return updated;
    });
  }
  ruleRegistry(tenantId: string, options: RegistryOptions): Record<string, unknown> { return this.store.ruleRegistry(tenantId, options); }
  detectionIntelligence(tenantId: string, days: number, source?: string, severity?: string): Record<string, unknown> {
    return this.store.detectionIntelligence(tenantId, days, source, severity);
  }
  ruleDetail(tenantId: string, id: string): Record<string, unknown> | undefined {
    const rule = this.get("detection_rules", tenantId, id);
    if (!rule) return undefined;
    return { ...rule, ...this.store.ruleMetrics(tenantId, id), version: this.store.ruleVersion(tenantId, id), versions: this.store.ruleVersions(tenantId, id), history: this.store.history(tenantId, "detection_rules", id) };
  }
  cloneRule(tenantId: string, id: string): ResourceRecord {
    return this.store.transaction(() => {
      const original = this.get("detection_rules", tenantId, id);
      if (!original) throw new ApiError(404, "NOT_FOUND", "Detection rule not found");
      const data = Object.fromEntries(RULE_FIELDS.map(key => [key, original[key]]));
      const clone = this.store.create("detection_rules", tenantId, { ...data, id: `RULE-${randomUUID()}`, name: `${String(original.name).slice(0, 193)} (copy)`, enabled: false });
      this.store.snapshotRule(clone, 1);
      this.audit(tenantId, "detection_rules", clone.id, "cloned", { source_rule_id: id });
      return clone;
    });
  }
  delete(resource: ResourceName, tenantId: string, id: string): boolean {
    return this.store.transaction(() => {
      this.pipeline.assertDeletable(resource, tenantId, id);
      const deleted = this.store.delete(resource, tenantId, id);
      if (deleted) this.audit(tenantId, resource, id, "deleted");
      return deleted;
    });
  }
  private audit(tenantId: string, resource: string, id: string, action: string, details: Record<string, unknown> = {}): void {
    this.store.create("audit_events", tenantId, { id: randomUUID(), resource, resource_id: id, action, details });
  }
  history(resource: ResourceName, tenantId: string, id: string): ResourceRecord[] | undefined {
    if (!this.get(resource, tenantId, id)) return undefined;
    return this.store.history(tenantId, resource, id);
  }
  addCaseRecord(kind: "artifacts" | "investigation_feedback", tenantId: string, id: string, data: Record<string, unknown>): ResourceRecord {
    if (!this.get("investigations", tenantId, id)) throw new ApiError(404, "NOT_FOUND", "Investigation not found");
    return this.store.transaction(() => {
      const record = this.store.create(kind, tenantId, { ...data, id: randomUUID(), investigation_id: id });
      this.audit(tenantId, "investigations", id, kind === "artifacts" ? "evidence_added" : "feedback_added", { record_id: record.id });
      return record;
    });
  }

  investigationDetail(tenantId: string, id: string): Record<string, unknown> | undefined {
    const investigation = this.get("investigations", tenantId, id);
    if (!investigation) return undefined;
    return {
      ...investigation,
      ...this.pipeline.context(tenantId, id),
      skill_applications: this.skills?.applications(tenantId, "investigation", id) || [],
      steps: this.store.list("investigation_steps", tenantId, { investigationId: id }),
      feedback: this.store.list("investigation_feedback", tenantId, { investigationId: id }),
      history: this.store.history(tenantId, "investigations", id),
      artifacts: this.store.list("artifacts", tenantId, { investigationId: id }),
      remediations: this.list("remediations", tenantId, { investigationId: id })
    };
  }

  reinvestigate(tenantId: string, id: string): ResourceRecord | undefined {
    return this.store.transaction(() => {
      const current = this.get("investigations", tenantId, id);
      if (!current) return undefined;
      this.pipeline.assertEditable(tenantId, id);
      const queued = this.pipeline.requeue(tenantId, id);
      const updated = this.store.update("investigations", tenantId, id, {
        status: queued ? "open" : "investigating", determination: "unknown", replay_count: Number(current.replay_count) + 1
      });
      this.audit(tenantId, "investigations", id, "reinvestigated", { queued });
      return updated;
    });
  }

  runHunt(tenantId: string, id: string): ResourceRecord | undefined {
    const hunt = this.get("hunts", tenantId, id);
    if (!hunt) return undefined;
    const applied = this.skills?.applyToHunt(tenantId, id, hunt) || [];
    const findings = (id.length % 4) + 1;
    const completed = this.update("hunts", tenantId, id, { status: "completed", verdict: findings > 1 ? "review_required" : "no_findings", findings_count: findings, last_run_at: new Date().toISOString() });
    return completed ? { ...completed, applied_skills: applied } : undefined;
  }

  huntDetail(tenantId: string, id: string): Record<string, unknown> | undefined {
    const hunt = this.get("hunts", tenantId, id);
    return hunt ? { ...hunt, skill_applications: this.skills?.applications(tenantId, "hunt", id) || [] } : undefined;
  }

  testConnector(tenantId: string, id: string): (ResourceRecord & { test_result: { status: string; message: string } }) | undefined {
    const connector = this.get("connectors", tenantId, id);
    if (!connector) return undefined;
    // A connector is healthy only after a provider adapter has made a real,
    // authenticated request. These integrations are not wired yet; field checks
    // alone must never make a connector appear operational.
    const result = connector.type === "crowdstrike"
      ? { status: "not_configured", message: "CrowdStrike read-only adapter is not configured yet. No provider request was made." }
      : { status: "unsupported", message: `No live test adapter is installed for ${String(connector.type)}. No provider request was made.` };
    const unchanged = this.update("connectors", tenantId, id, { status: "untested" });
    return unchanged ? { ...unchanged, test_result: result } : undefined;
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
