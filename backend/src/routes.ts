import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { ApiError } from "./errors.js";
import type { PlatformService } from "./services/platform-service.js";
import type { AlertPipeline, AlertInput } from "./services/alert-pipeline.js";
import type { ApiSources } from "./services/api-sources.js";
import type { Skills } from "./services/skills.js";
import { tenantFor } from "./auth.js";

const IdParams = Type.Object({ id: Type.String({ minLength: 1 }) });
const ListQuery = Type.Object({
  search: Type.Optional(Type.String()), status: Type.Optional(Type.String()), severity: Type.Optional(Type.String()),
  investigationId: Type.Optional(Type.String()), reportId: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })), offset: Type.Optional(Type.Integer({ minimum: 0 }))
});
const Body = Type.Record(Type.String(), Type.Unknown());
const Severity = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")]);
const AlertSchema = Type.Object({
  source: Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" }),
  external_id: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  rule_id: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
  title: Type.String({ minLength: 1, maxLength: 300, pattern: "\\S" }), severity: Severity,
  summary: Type.Optional(Type.String({ maxLength: 4000 })),
  category: Type.Optional(Type.String({ maxLength: 120 })), alert_type: Type.Optional(Type.String({ maxLength: 120 })),
  primary_entity: Type.Optional(Type.String({ maxLength: 500 })),
  insight_refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 })),
  evidence: Type.Optional(Type.Array(Type.Object({
    type: Type.Union([Type.Literal("entity"), Type.Literal("ip"), Type.Literal("domain"), Type.Literal("file"), Type.Literal("email"), Type.Literal("url")]),
    value: Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }), label: Type.Optional(Type.String({ maxLength: 200 }))
  }, { additionalProperties: false }), { maxItems: 50 }))
}, { additionalProperties: false });
const DetectionSchema = Type.Object({
  expected_version: Type.Optional(Type.Integer({ minimum: 1 })),
  name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  description: Type.Optional(Type.String({ maxLength: 4000 })),
  mitre_techniques: Type.Optional(Type.Array(Type.String())),
  execution_mode: Type.Optional(Type.Union([Type.Literal("scheduled"), Type.Literal("realtime")])),
  enabled: Type.Optional(Type.Boolean()), severity: Severity,
  query: Type.Optional(Type.String({ maxLength: 20000 })),
  schedule: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  lookback_window: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  routing: Type.Optional(Type.Union([Type.Literal("Investigate"), Type.Literal("Sample (10%)"), Type.Literal("Suppress"), Type.Literal("Escalate")]))
}, { additionalProperties: false });
const CreateSchemas = {
  investigations: Type.Object({ title: Type.String({ minLength: 1 }), summary: Type.Optional(Type.String()), source: Type.String({ minLength: 1 }), category: Type.Optional(Type.String()), insight_refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 })), severity: Severity, status: Type.Optional(Type.String()), determination: Type.Optional(Type.String()), risk_score: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })), owner: Type.Optional(Type.String()), primary_entity: Type.Optional(Type.String()) }),
  detection_rules: DetectionSchema,
  hunts: Type.Object({ name: Type.String({ minLength: 1 }), query: Type.String({ minLength: 1 }), source: Type.Optional(Type.String()), insight_refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 })) }),
  connectors: Type.Object({ type: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), workspace_url: Type.Optional(Type.String()), client_id: Type.Optional(Type.String()), secret: Type.Optional(Type.String()), config: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }),
  remediations: Type.Object({ investigation_id: Type.String({ minLength: 1 }), action_type: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), connector: Type.Optional(Type.String()) }),
  threat_intel_reports: Type.Object({ title: Type.String({ minLength: 1 }), summary: Type.Optional(Type.String()), source: Type.Optional(Type.String()), report_type: Type.Optional(Type.String()), severity: Severity, ioc_count: Type.Optional(Type.Integer({ minimum: 0 })), tags: Type.Optional(Type.Array(Type.String())), published_at: Type.Optional(Type.String()) }),
  threat_indicators: Type.Object({ report_id: Type.String({ minLength: 1 }), indicator_type: Type.String({ minLength: 1 }), value: Type.String({ minLength: 1 }), severity: Type.Optional(Severity), hits: Type.Optional(Type.Integer({ minimum: 0 })) })
} as const;

function tenant(request: FastifyRequest, fallback: string): string {
  return tenantFor(request, fallback);
}
function required<T>(value: T | undefined, name: string): T { if (!value) throw new ApiError(404, "NOT_FOUND", `${name} not found`); return value; }

const SkillBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" })),
  skill_type: Type.Optional(Type.Union([Type.Literal("strategy"), Type.Literal("content")])),
  description: Type.Optional(Type.String({ maxLength: 4000 })), apply_when: Type.Optional(Type.String({ maxLength: 4000 })), content_markdown: Type.Optional(Type.String({ maxLength: 30000 })),
  modules: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 20 })), connectors: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })),
  alert_types: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })), alert_categories: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })),
  source_entities: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 })), runtime_entities: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 })),
  insight_refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 })), tags: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 100 }))
}, { additionalProperties: false });
const SkillMaterialParams = Type.Object({ id: Type.String({ minLength: 1 }), materialId: Type.String({ minLength: 1 }) });
const SkillMaterialBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 180, pattern: "\\S" })),
  kind: Type.Optional(Type.Union([Type.Literal("reference"), Type.Literal("checklist"), Type.Literal("example")])),
  filename: Type.Optional(Type.String({ maxLength: 255 })),
  source_url: Type.Optional(Type.String({ maxLength: 2048 })),
  content: Type.Optional(Type.String({ maxLength: 150000 }))
}, { additionalProperties: false });

export async function registerRoutes(app: FastifyInstance, service: PlatformService, defaultTenantId: string, pipeline: AlertPipeline, sources: ApiSources, skills: Skills): Promise<void> {
  app.get("/api/v1/skills", { schema: { querystring: Type.Object({ search: Type.Optional(Type.String({ maxLength: 200 })), state: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("published")])), module: Type.Optional(Type.String({ maxLength: 100 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) }) } }, async request => skills.list(tenant(request, defaultTenantId), request.query as { search?: string; state?: string; module?: string; limit?: number; offset?: number }));
  app.get("/api/v1/skills/suggestions", { schema: { querystring: Type.Object({ status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("accepted"), Type.Literal("dismissed")])), refresh: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])) }) } }, async request => skills.listSuggestions(tenant(request, defaultTenantId), (request.query as { status?: string; refresh?: string }).status));
  app.post("/api/v1/skills/suggestions/:id/accept", { schema: { params: IdParams } }, async (request, reply) => reply.code(201).send(required(skills.acceptSuggestion(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.principal?.id || "local-development"), "suggestion")));
  app.post("/api/v1/skills/suggestions/:id/dismiss", { schema: { params: IdParams } }, async request => required(skills.dismissSuggestion(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.principal?.id || "local-development"), "suggestion"));
  app.get("/api/v1/skills/outcomes", async request => skills.outcomes(tenant(request, defaultTenantId)));
  app.post("/api/v1/skills/applications/:id/feedback", { schema: { params: IdParams, body: Type.Object({ rating: Type.Union([Type.Literal("helpful"), Type.Literal("not_helpful")]), comment: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false }) } }, async (request, reply) => reply.code(201).send(skills.submitApplicationFeedback(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.body as { rating: "helpful" | "not_helpful"; comment?: string }, request.principal?.id || "local-development")));
  app.post("/api/v1/skills", { schema: { body: SkillBody } }, async (request, reply) => reply.code(201).send(skills.create(tenant(request, defaultTenantId), request.body as never, request.principal?.id || "local-development")));
  app.get("/api/v1/skills/:id/history", { schema: { params: IdParams } }, async request => ({ items: skills.history(tenant(request, defaultTenantId), (request.params as { id: string }).id) }));
  app.post("/api/v1/skills/:id/publish", { schema: { params: IdParams } }, async request => required(skills.publish(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.principal?.id || "local-development"), "skill"));
  app.post("/api/v1/skills/:id/toggle", { schema: { params: IdParams } }, async request => required(skills.toggle(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.principal?.id || "local-development"), "skill"));
  app.get("/api/v1/skills/:id", { schema: { params: IdParams } }, async request => required(skills.get(tenant(request, defaultTenantId), (request.params as { id: string }).id), "skill"));
  app.patch("/api/v1/skills/:id", { schema: { params: IdParams, body: SkillBody } }, async request => required(skills.update(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.body as never, request.principal?.id || "local-development"), "skill"));
  app.delete("/api/v1/skills/:id", { schema: { params: IdParams } }, async (request, reply) => { if (!skills.delete(tenant(request, defaultTenantId), (request.params as { id: string }).id)) throw new ApiError(404, "NOT_FOUND", "Skill not found"); return reply.code(204).send(); });
  app.get("/api/v1/skills/:id/materials", { schema: { params: IdParams } }, async request => required(skills.listMaterials(tenant(request, defaultTenantId), (request.params as { id: string }).id), "skill"));
  app.post("/api/v1/skills/:id/materials", { bodyLimit: 1048576, schema: { params: IdParams, body: SkillMaterialBody } }, async (request, reply) => reply.code(201).send(required(skills.createMaterial(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.body as never, request.principal?.id || "local-development"), "skill")));
  app.get("/api/v1/skills/:id/materials/:materialId/versions", { schema: { params: SkillMaterialParams } }, async request => ({ items: required(skills.materialVersions(tenant(request, defaultTenantId), (request.params as { id: string; materialId: string }).id, (request.params as { materialId: string }).materialId), "material") }));
  app.get("/api/v1/skills/:id/materials/:materialId", { schema: { params: SkillMaterialParams } }, async request => required(skills.getMaterial(tenant(request, defaultTenantId), (request.params as { id: string; materialId: string }).id, (request.params as { materialId: string }).materialId), "material"));
  app.patch("/api/v1/skills/:id/materials/:materialId", { bodyLimit: 1048576, schema: { params: SkillMaterialParams, body: SkillMaterialBody } }, async request => required(skills.updateMaterial(tenant(request, defaultTenantId), (request.params as { id: string; materialId: string }).id, (request.params as { materialId: string }).materialId, request.body as never, request.principal?.id || "local-development"), "material"));
  app.delete("/api/v1/skills/:id/materials/:materialId", { schema: { params: SkillMaterialParams } }, async (request, reply) => { if (!skills.archiveMaterial(tenant(request, defaultTenantId), (request.params as { id: string; materialId: string }).id, (request.params as { materialId: string }).materialId, request.principal?.id || "local-development")) throw new ApiError(404, "NOT_FOUND", "Material not found"); return reply.code(204).send(); });
  app.get("/api/v1/detection-registry", { schema: { querystring: Type.Object({
    search: Type.Optional(Type.String({ maxLength: 200 })), severity: Type.Optional(Severity),
    enabled: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])), source: Type.Optional(Type.String({ maxLength: 200 })),
    sort: Type.Optional(Type.Union([Type.Literal("name"), Type.Literal("updated_at"), Type.Literal("severity"), Type.Literal("detections")])),
    direction: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 }))
  }) } }, async request => service.ruleRegistry(tenant(request, defaultTenantId), request.query as Record<string, never>));
  app.get("/api/v1/detection-intelligence", { schema: { querystring: Type.Object({
    days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90, default: 7 })),
    source: Type.Optional(Type.String({ maxLength: 200 })), severity: Type.Optional(Severity)
  }) } }, async request => {
    const query = request.query as { days?: number; source?: string; severity?: "low" | "medium" | "high" | "critical" };
    return service.detectionIntelligence(tenant(request, defaultTenantId), query.days ?? 7, query.source, query.severity);
  });
  app.post("/api/v1/detection-rules/:id/clone", { schema: { params: IdParams } }, async (request, reply) => reply.code(201).send(service.cloneRule(tenant(request, defaultTenantId), (request.params as { id: string }).id)));
  const Days = Type.Integer({ minimum: 1, maximum: 365, default: 30 });
  const EventMapping = Type.Object({
    fields: Type.Record(Type.String(), Type.String()),
    severity_map: Type.Optional(Type.Record(Type.String(), Severity))
  }, { additionalProperties: false });
  app.get("/api/v1/api-sources", async request => ({ items: sources.list(tenant(request, defaultTenantId)) }));
  app.post("/api/v1/api-sources", { schema: { body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }), provider: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }), rule_id: Type.String({ minLength: 1 }), expires_in_days: Type.Optional(Days) }, { additionalProperties: false }) } }, async (request, reply) => {
    const body = request.body as { name: string; provider: string; rule_id: string; expires_in_days?: number };
    return reply.header("Cache-Control", "no-store").code(201).send(sources.create(tenant(request, defaultTenantId), { ...body, expires_in_days: body.expires_in_days ?? 30 }, request.principal?.id || "local-development"));
  });
  app.get("/api/v1/api-sources/:id", { schema: { params: IdParams } }, async request => required(sources.get(tenant(request, defaultTenantId), (request.params as { id: string }).id), "API source"));
  app.patch("/api/v1/api-sources/:id/mapping", { schema: { params: IdParams, body: Type.Object({ mapping: EventMapping }, { additionalProperties: false }) } }, async request => {
    const body = request.body as { mapping: unknown };
    return sources.updateMapping(tenant(request, defaultTenantId), (request.params as { id: string }).id, body.mapping, request.principal?.id || "local-development");
  });
  app.post("/api/v1/api-sources/:id/mapping/preview", { bodyLimit: 131072, schema: { params: IdParams, body: Type.Object({ mapping: EventMapping, sample: Type.Record(Type.String(), Type.Unknown()) }, { additionalProperties: false }) } }, async request => {
    const body = request.body as { mapping: unknown; sample: unknown };
    return sources.previewMapping(tenant(request, defaultTenantId), (request.params as { id: string }).id, body.mapping, body.sample);
  });
  app.post("/api/v1/api-sources/:id/rotate-key", { schema: { params: IdParams, body: Type.Object({ expires_in_days: Type.Optional(Days) }, { additionalProperties: false }) } }, async (request, reply) => reply.header("Cache-Control", "no-store").send(sources.rotate(tenant(request, defaultTenantId), (request.params as { id: string }).id, (request.body as { expires_in_days?: number }).expires_in_days ?? 30, request.principal?.id || "local-development")));
  app.post("/api/v1/api-sources/:id/revoke", { schema: { params: IdParams } }, async request => sources.revoke(tenant(request, defaultTenantId), (request.params as { id: string }).id, request.principal?.id || "local-development"));
  app.post("/api/v1/intake/:id/alerts", { config: { access: "source" }, bodyLimit: 131072, schema: { params: IdParams, body: Type.Omit(AlertSchema, ["source", "rule_id"]) } }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const token = request.headers.authorization!.slice(7);
    const source = sources.get(request.principal!.tenant_id, id)!;
    const result = pipeline.ingest(request.principal!.tenant_id, { ...(request.body as Omit<AlertInput, "source" | "rule_id">), source: source.source, rule_id: source.rule_id }, () => {
      if (!sources.authenticate(id, token)) throw new ApiError(401, "UNAUTHENTICATED", "A valid credential is required.");
    });
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });
  app.post("/api/v1/intake/:id/events", { config: { access: "source" }, bodyLimit: 131072, schema: { params: IdParams, body: Type.Record(Type.String(), Type.Unknown()) } }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const token = request.headers.authorization!.slice(7);
    const mapped = sources.mapEvent(request.principal!.tenant_id, id, request.body);
    if (!mapped.normalized) throw new ApiError(400, "NATIVE_EVENT_INVALID", "The native event could not be mapped.", mapped.errors);
    const result = pipeline.ingest(request.principal!.tenant_id, mapped.normalized, () => {
      if (!sources.authenticate(id, token)) throw new ApiError(401, "UNAUTHENTICATED", "A valid credential is required.");
    });
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });
  app.get("/api/v1/investigation-queue", async request => pipeline.queue(tenant(request, defaultTenantId)));
  app.post("/api/v1/alerts", { bodyLimit: 131072, schema: { body: AlertSchema } }, async (request, reply) => {
    const result = pipeline.ingest(tenant(request, defaultTenantId), request.body as AlertInput);
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });
  app.get("/api/v1/alerts", { schema: { querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) }) } }, async request => {
    const { limit, offset } = request.query as { limit?: number; offset?: number };
    return { items: pipeline.list(tenant(request, defaultTenantId), limit, offset) };
  });
  app.get("/api/v1/alerts/:id", { schema: { params: IdParams } }, async request => required(pipeline.get(tenant(request, defaultTenantId), (request.params as { id: string }).id), "Alert"));
  app.get("/health", { config: { access: "public" } }, async () => ({ status: "ok", database: "sqlite", version: "1.0.0", timestamp: new Date().toISOString() }));
  app.get("/api/v1/dashboard", async (request) => service.dashboard(tenant(request, defaultTenantId)));
  for (const [path, resource] of [["investigations", "investigations"], ["detection-rules", "detection_rules"]] as const) {
    app.get(`/api/v1/${path}/:id/history`, { schema: { params: IdParams } }, async request => ({ items: required(service.history(resource, tenant(request, defaultTenantId), (request.params as {id: string}).id), resource) }));
  }
  app.post("/api/v1/investigations/:id/feedback", {
    schema: { params: IdParams, body: Type.Object({ comment: Type.String({ minLength: 1, maxLength: 4000, pattern: "\\S" }) }, { additionalProperties: false }) }
  }, async (request, reply) => reply.code(201).send(service.addCaseRecord("investigation_feedback", tenant(request, defaultTenantId), (request.params as {id: string}).id, request.body as Record<string, unknown>)));
  app.post("/api/v1/investigations/:id/artifacts", {
    schema: { params: IdParams, body: Type.Object({
      type: Type.Union([Type.Literal("entity"), Type.Literal("ip"), Type.Literal("domain"), Type.Literal("file"), Type.Literal("email"), Type.Literal("url")]),
      value: Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }),
      label: Type.Optional(Type.String({ maxLength: 200 })), metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
    }, { additionalProperties: false }) }
  }, async (request, reply) => reply.code(201).send(service.addCaseRecord("artifacts", tenant(request, defaultTenantId), (request.params as {id: string}).id, request.body as Record<string, unknown>)));

  const resources = ["investigations", "detection_rules", "hunts", "connectors", "remediations", "threat_intel_reports", "threat_indicators"] as const;
  const paths = { investigations: "investigations", detection_rules: "detection-rules", hunts: "hunts", connectors: "connectors", remediations: "remediations", threat_intel_reports: "threat-intel-reports", threat_indicators: "threat-indicators" } as const;
  for (const resource of resources) {
    const path = `/api/v1/${paths[resource]}`;
    app.get(path, { schema: { querystring: ListQuery } }, async (request) => ({ items: service.list(resource, tenant(request, defaultTenantId), request.query as Record<string, never>) }));
    app.post(path, { schema: { body: CreateSchemas[resource] } }, async (request, reply) => reply.code(201).send(service.create(resource, tenant(request, defaultTenantId), request.body as Record<string, unknown>)));
    app.get(`${path}/:id`, { schema: { params: IdParams } }, async (request) => {
      const { id } = request.params as { id: string };
      const detail = resource === "detection_rules" ? service.ruleDetail(tenant(request, defaultTenantId), id) : resource === "investigations" ? service.investigationDetail(tenant(request, defaultTenantId), id) : resource === "threat_intel_reports" ? service.threatIntelDetail(tenant(request, defaultTenantId), id) : resource === "hunts" ? service.huntDetail(tenant(request, defaultTenantId), id) : service.get(resource, tenant(request, defaultTenantId), id);
      return required(detail, resource);
    });
    app.patch(`${path}/:id`, { schema: { params: IdParams, body: resource === "detection_rules" ? Type.Partial(DetectionSchema) : Body } }, async (request) => {
      const { id } = request.params as { id: string };
      return required(service.update(resource, tenant(request, defaultTenantId), id, request.body as Record<string, unknown>), resource);
    });
    app.delete(`${path}/:id`, { schema: { params: IdParams } }, async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!service.delete(resource, tenant(request, defaultTenantId), id)) throw new ApiError(404, "NOT_FOUND", `${resource} not found`);
      return reply.code(204).send();
    });
  }

  app.post("/api/v1/investigations/:id/reinvestigate", { schema: { params: IdParams } }, async (request) => required(service.reinvestigate(tenant(request, defaultTenantId), (request.params as { id: string }).id), "investigation"));
  app.post("/api/v1/investigations/:id/determination", { schema: { params: IdParams, body: Type.Object({ determination: Type.Union([Type.Literal("unknown"), Type.Literal("benign"), Type.Literal("suspicious"), Type.Literal("malicious"), Type.Literal("mitigated")]) }) } }, async (request) => required(service.update("investigations", tenant(request, defaultTenantId), (request.params as { id: string }).id, request.body as Record<string, unknown>), "investigation"));
  app.post("/api/v1/detection-rules/:id/toggle", { schema: { params: IdParams } }, async (request) => { const id=(request.params as {id:string}).id; const current=required(service.get("detection_rules",tenant(request,defaultTenantId),id),"detection rule"); return service.update("detection_rules",tenant(request,defaultTenantId),id,{enabled:!current.enabled}); });
  app.post("/api/v1/hunts/:id/run", { schema: { params: IdParams } }, async (request) => required(service.runHunt(tenant(request, defaultTenantId), (request.params as { id: string }).id), "hunt"));
  app.post("/api/v1/connectors/:id/test", { schema: { params: IdParams } }, async (request) => required(service.testConnector(tenant(request, defaultTenantId), (request.params as { id: string }).id), "connector"));
  app.post("/api/v1/remediations/:id/execute", { schema: { params: IdParams } }, async (request) => required(service.executeRemediation(tenant(request, defaultTenantId), (request.params as { id: string }).id), "remediation"));
  app.get("/api/v1/threat-intel/dashboard", async (request) => service.threatIntelDashboard(tenant(request, defaultTenantId)));
  app.post("/api/v1/threat-intel-reports/:id/launch-hunt", { schema: { params: IdParams } }, async (request) => required(service.launchThreatHunt(tenant(request, defaultTenantId), (request.params as { id: string }).id), "threat intel report"));
}
