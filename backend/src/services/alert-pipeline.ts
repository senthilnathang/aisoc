import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../errors.js";
import type { Store } from "../repositories/store.js";
import type { ResourceRecord } from "../types/domain.js";
import type { Skills } from "./skills.js";

export interface AlertInput {
  source: string;
  external_id: string;
  rule_id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  summary?: string;
  primary_entity?: string;
  category?: string;
  alert_type?: string;
  insight_refs?: string[];
  evidence?: { type: string; value: string; label?: string }[];
}
interface AlertRow extends ResourceRecord {
  source: string; external_id: string; rule_id: string; investigation_id: string | null;
  routing: string; disposition: string; title: string; severity: string;
  payload_json: string; payload_hash: string;
}
interface JobRow extends ResourceRecord {
  investigation_id: string; alert_id: string; status: string; phase: number; result_json: string;
}

export class AlertPipeline {
  constructor(private readonly db: DatabaseSync, private readonly store: Store, private readonly skills?: Skills) {}

  private alert(row: AlertRow) {
    const { payload_json, payload_hash: _hash, ...fields } = row;
    return { ...fields, payload: JSON.parse(payload_json) as AlertInput };
  }
  private job(row: JobRow) {
    const { result_json, ...fields } = row;
    return { ...fields, result: JSON.parse(result_json), total_phases: 3, mode: "local-deterministic" };
  }
  private audit(tenantId: string, resource: string, id: string, action: string, details: Record<string, unknown>) {
    this.store.create("audit_events", tenantId, { id: randomUUID(), resource, resource_id: id, action, details });
  }
  list(tenantId: string, limit = 100, offset = 0) {
    return (this.db.prepare("SELECT * FROM alerts WHERE tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?").all(tenantId, limit, offset) as AlertRow[]).map(row => this.alert(row));
  }
  queue(tenantId: string) {
    const items = this.db.prepare(`SELECT i.*, j.id AS job_id, j.status AS run_status, j.phase AS run_phase
      FROM investigations i LEFT JOIN investigation_jobs j ON j.rowid = (
        SELECT recent.rowid FROM investigation_jobs recent WHERE recent.tenant_id = i.tenant_id
        AND recent.investigation_id = i.id ORDER BY recent.created_at DESC, recent.rowid DESC LIMIT 1
      ) WHERE i.tenant_id = ? ORDER BY i.created_at DESC, i.rowid DESC LIMIT 100`).all(tenantId);
    return {
      items,
      summary: {
        alerts: this.store.count("alerts", tenantId),
        active_runs: this.store.count("investigation_jobs", tenantId, "status IN ('queued','running')"),
        open_cases: this.store.count("investigations", tenantId, "status NOT IN ('closed','resolved')")
      }
    };
  }
  get(tenantId: string, id: string) {
    const row = this.db.prepare("SELECT * FROM alerts WHERE tenant_id = ? AND id = ?").get(tenantId, id) as AlertRow | undefined;
    return row ? this.alert(row) : undefined;
  }
  context(tenantId: string, investigationId: string) {
    const alerts = (this.db.prepare("SELECT * FROM alerts WHERE tenant_id = ? AND investigation_id = ? ORDER BY created_at DESC").all(tenantId, investigationId) as AlertRow[]).map(row => this.alert(row));
    const jobs = (this.db.prepare("SELECT * FROM investigation_jobs WHERE tenant_id = ? AND investigation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20").all(tenantId, investigationId) as JobRow[]).map(row => this.job(row));
    return { alerts, jobs };
  }
  assertEditable(tenantId: string, id: string) {
    if (this.db.prepare("SELECT id FROM investigation_jobs WHERE tenant_id = ? AND investigation_id = ? AND status IN ('queued','running')").get(tenantId, id)) {
      throw new ApiError(409, "INVESTIGATION_RUNNING", "Wait for the current investigation run before changing its outcome.");
    }
  }
  assertDeletable(resource: string, tenantId: string, id: string) {
    if (resource === "detection_rules" && this.db.prepare("SELECT id FROM api_sources WHERE tenant_id = ? AND rule_id = ? LIMIT 1").get(tenantId, id)) {
      throw new ApiError(409, "SOURCE_REFERENCE_EXISTS", "An API source references this rule. Disable the rule instead.");
    }
    const column = resource === "investigations" ? "investigation_id" : resource === "detection_rules" ? "rule_id" : null;
    if (column && this.db.prepare(`SELECT id FROM alerts WHERE tenant_id = ? AND ${column} = ? LIMIT 1`).get(tenantId, id)) {
      throw new ApiError(409, "ALERT_REFERENCE_EXISTS", "This record is retained by ingested alerts. Close the case or disable the rule instead.");
    }
  }
  ingest(tenantId: string, input: AlertInput, authorize?: () => void) {
    // Fixed key order and explicit defaults make JSON object ordering irrelevant.
    const payload: AlertInput = {
      source: input.source.trim(), external_id: input.external_id.trim(), rule_id: input.rule_id.trim(),
      title: input.title.trim(), severity: input.severity, summary: input.summary?.trim() || "",
      primary_entity: input.primary_entity?.trim() || "",
      evidence: (input.evidence || []).map(item => ({ type: item.type, value: item.value.trim(), label: item.label?.trim() || "" }))
    };
    if (input.category?.trim()) payload.category = input.category.trim();
    if (input.alert_type?.trim()) payload.alert_type = input.alert_type.trim();
    if (input.insight_refs?.length) payload.insight_refs = [...new Set(input.insight_refs.map(value => value.trim()).filter(Boolean))].sort();
    const serialized = JSON.stringify(payload);
    const hash = createHash("sha256").update(serialized).digest("hex");
    return this.store.transaction(() => {
      authorize?.();
      const existing = this.db.prepare("SELECT * FROM alerts WHERE tenant_id = ? AND source = ? AND external_id = ?").get(tenantId, payload.source, payload.external_id) as AlertRow | undefined;
      if (existing) {
        if (existing.payload_hash !== hash) throw new ApiError(409, "ALERT_CONFLICT", "This source alert ID already exists with different content.");
        return { duplicate: true, alert: this.alert(existing) };
      }
      const rule = this.store.get("detection_rules", tenantId, payload.rule_id);
      if (!rule) throw new ApiError(404, "NOT_FOUND", "Detection rule not found");
      if (!rule.enabled) throw new ApiError(409, "RULE_DISABLED", "Enable the detection rule before ingesting alerts.");
      const sampleKey = JSON.stringify([tenantId, payload.source, payload.external_id]);
      const sampled = createHash("sha256").update(sampleKey).digest().readUInt32BE(0) % 10 === 0;
      const disposition = rule.routing === "Suppress" ? "suppressed" : rule.routing === "Sample (10%)" && !sampled ? "not_sampled" : "investigate";
      const alertId = `ALT-${randomUUID()}`;
      const investigationId = disposition === "investigate" ? `INV-${randomUUID()}` : null;
      const now = new Date().toISOString();
      if (investigationId) this.store.create("investigations", tenantId, {
        id: investigationId, title: payload.title, source: payload.source, summary: payload.summary,
        severity: payload.severity, category: payload.category || "other", insight_refs: payload.insight_refs || [], primary_entity: payload.primary_entity, status: "open", determination: "unknown",
        owner: rule.routing === "Escalate" ? "Analyst review" : "Local investigation worker"
      });
      this.db.prepare(`INSERT INTO alerts (id, tenant_id, source, external_id, rule_id, investigation_id, title, severity, routing, disposition, payload_json, payload_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(alertId, tenantId, payload.source, payload.external_id, payload.rule_id, investigationId, payload.title, payload.severity, String(rule.routing), disposition, serialized, hash, now, now);
      if (investigationId) {
        this.skills?.applyToInvestigation(tenantId, investigationId, { source: payload.source, title: payload.alert_type || payload.title, category: payload.category || "other", source_entities: [payload.primary_entity || "", ...(payload.evidence || []).flatMap(item => [item.type, item.label || "", item.value])], runtime_entities: [], insight_refs: payload.insight_refs || [] });
        this.enqueue(tenantId, investigationId, alertId);
        this.audit(tenantId, "investigations", investigationId, "alert_received", { alert_id: alertId, rule_id: payload.rule_id });
      }
      this.store.update("detection_rules", tenantId, payload.rule_id, { detections: Number(rule.detections) + 1, investigations: Number(rule.investigations) + (investigationId ? 1 : 0), last_activity_at: now });
      this.audit(tenantId, "detection_rules", payload.rule_id, "alert_received", { alert_id: alertId, disposition });
      return { duplicate: false, alert: this.get(tenantId, alertId)! };
    });
  }
  private enqueue(tenantId: string, investigationId: string, alertId: string) {
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO investigation_jobs (id, tenant_id, investigation_id, alert_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)")
      .run(`JOB-${randomUUID()}`, tenantId, investigationId, alertId, now, now);
  }
  // Called inside PlatformService's transaction after checking for an active run.
  requeue(tenantId: string, investigationId: string) {
    const alert = this.db.prepare("SELECT id FROM alerts WHERE tenant_id = ? AND investigation_id = ? LIMIT 1").get(tenantId, investigationId);
    if (!alert) return false;
    this.enqueue(tenantId, investigationId, String(alert.id));
    this.audit(tenantId, "investigations", investigationId, "investigation_queued", { alert_id: alert.id });
    return true;
  }

  /** One synchronous, transactional phase per tick. No external side effects.
   * SQLite's write lock serializes workers; committed phases resume after restart.
   */
  processNext(): boolean {
    return this.store.transaction(() => {
      const job = this.db.prepare("SELECT * FROM investigation_jobs WHERE status IN ('queued','running') ORDER BY updated_at ASC, rowid ASC LIMIT 1").get() as JobRow | undefined;
      if (!job) return false;
      this.db.exec("SAVEPOINT job_phase");
      try {
        const alert = this.get(job.tenant_id, job.alert_id);
        if (!alert) throw new Error("Source alert unavailable");
        const payload = alert.payload;
        let result = JSON.parse(job.result_json) as { matches?: { value: string; indicator_type: string; id: string }[] };
        let title: string;
        let conclusion: string;
        let request: Record<string, unknown>;
        let response: Record<string, unknown>;
        if (job.phase === 0) {
          title = "Record supplied evidence";
          const items = [...(payload.evidence || [])];
          if (payload.primary_entity) items.unshift({ type: "entity", value: payload.primary_entity, label: "Primary entity" });
          const unique = new Map(items.map(item => [JSON.stringify([item.type, item.value]), item]));
          for (const [key, item] of unique) {
            const id = `ART-${alert.id}-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
            if (!this.store.get("artifacts", job.tenant_id, id)) this.store.create("artifacts", job.tenant_id, {
              id, investigation_id: job.investigation_id, ...item,
              metadata: { provenance: "Submitted alert; not independently verified", alert_id: alert.id, source: payload.source }
            });
          }
          this.store.update("investigations", job.tenant_id, job.investigation_id, { status: "investigating" });
          request = { source: payload.source, external_id: payload.external_id, evidence: items };
          response = { artifacts_recorded: unique.size, external_tools_executed: false };
          conclusion = `Recorded ${unique.size} distinct supplied artifacts. No external data was fetched.`;
        } else if (job.phase === 1) {
          title = "Compare with local threat indicators";
          const matches = new Map<string, { value: string; indicator_type: string; id: string }>();
          for (const item of payload.evidence || []) {
            // Exact type/value equality only. This is not a reputation service.
            for (const match of this.db.prepare("SELECT id, value, indicator_type FROM threat_indicators WHERE tenant_id = ? AND indicator_type = ? AND value = ? AND status = 'active' LIMIT 100")
              .all(job.tenant_id, item.type, item.value) as { id: string; value: string; indicator_type: string }[]) matches.set(match.id, match);
          }
          result = { matches: [...matches.values()] };
          request = { evidence: payload.evidence || [], method: "Exact type/value match against active tenant-local indicators" };
          response = { matches: result.matches, external_tools_executed: false };
          conclusion = `${matches.size} matching local indicators. A match is a review signal, not proof of compromise; no match does not establish safety.`;
        } else {
          title = "Record review outcome";
          const matchCount = result.matches?.length || 0;
          const determination = matchCount > 0 || ["high", "critical"].includes(payload.severity) ? "suspicious" : "unknown";
          this.skills?.applyToInvestigation(job.tenant_id, job.investigation_id, {
            source: payload.source, title: payload.alert_type || payload.title, category: payload.category || "other",
            source_entities: [payload.primary_entity || "", ...(payload.evidence || []).flatMap(item => [item.type, item.label || "", item.value])],
            runtime_entities: (result.matches || []).flatMap(item => [item.indicator_type, item.value]),
            insight_refs: payload.insight_refs || []
          });
          const summary = `Local review: ${matchCount} matching indicators; source severity ${payload.severity}. ${determination === "suspicious" ? "Analyst review required." : "Insufficient evidence for a determination."} No external tools executed.`;
          request = { source_severity: payload.severity, local_indicator_matches: matchCount };
          response = { determination, status: "open", analyst_review_required: true, external_tools_executed: false };
          conclusion = summary;
          // Do not close cases or declare malicious/benign based on a local heuristic.
          this.store.update("investigations", job.tenant_id, job.investigation_id, { determination, status: "open", summary });
        }
        this.store.create("investigation_steps", job.tenant_id, {
          id: `${job.id}:${job.phase}`, investigation_id: job.investigation_id, title, conclusion,
          tool: "Local deterministic worker", request: { ...request, run_id: job.id }, response
        });
        const status = job.phase === 2 ? "completed" : "running";
        this.db.prepare("UPDATE investigation_jobs SET status = ?, phase = ?, result_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(status, job.phase + 1, JSON.stringify(result), new Date().toISOString(), job.tenant_id, job.id);
        this.audit(job.tenant_id, "investigations", job.investigation_id, status === "completed" ? "investigation_completed" : "investigation_progress", { run_id: job.id, phase: job.phase + 1, title });
        this.db.exec("RELEASE job_phase");
      } catch (error) {
        this.db.exec("ROLLBACK TO job_phase; RELEASE job_phase");
        // Keep completed phases, roll back this phase, and require an explicit retry.
        this.db.prepare("UPDATE investigation_jobs SET status = 'failed', error = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run("Local processing failed. Review the recorded evidence and retry the investigation.", new Date().toISOString(), job.tenant_id, job.id);
        this.store.update("investigations", job.tenant_id, job.investigation_id, { status: "open" });
        this.audit(job.tenant_id, "investigations", job.investigation_id, "investigation_failed", { run_id: job.id, phase: job.phase });
      }
      return true;
    });
  }
}
