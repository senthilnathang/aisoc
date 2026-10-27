import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { ApiError } from "./errors.js";
import type { PlatformService } from "./services/platform-service.js";

const IdParams = Type.Object({ id: Type.String({ minLength: 1 }) });
const ListQuery = Type.Object({
  search: Type.Optional(Type.String()), status: Type.Optional(Type.String()), severity: Type.Optional(Type.String()),
  investigationId: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })), offset: Type.Optional(Type.Integer({ minimum: 0 }))
});
const Body = Type.Record(Type.String(), Type.Unknown());
const Severity = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")]);
const CreateSchemas = {
  investigations: Type.Object({ title: Type.String({ minLength: 1 }), summary: Type.Optional(Type.String()), source: Type.String({ minLength: 1 }), category: Type.Optional(Type.String()), severity: Severity, status: Type.Optional(Type.String()), determination: Type.Optional(Type.String()), risk_score: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })), owner: Type.Optional(Type.String()), primary_entity: Type.Optional(Type.String()) }),
  detection_rules: Type.Object({ name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), mitre_techniques: Type.Optional(Type.Array(Type.String())), execution_mode: Type.Optional(Type.String()), enabled: Type.Optional(Type.Boolean()), severity: Severity }),
  hunts: Type.Object({ name: Type.String({ minLength: 1 }), query: Type.String({ minLength: 1 }), source: Type.Optional(Type.String()) }),
  connectors: Type.Object({ type: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), workspace_url: Type.Optional(Type.String()), client_id: Type.Optional(Type.String()), secret: Type.Optional(Type.String()), config: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }),
  remediations: Type.Object({ investigation_id: Type.String({ minLength: 1 }), action_type: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), connector: Type.Optional(Type.String()) })
} as const;

function tenant(request: FastifyRequest, fallback: string): string {
  const value = request.headers["x-tenant-id"];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function required<T>(value: T | undefined, name: string): T { if (!value) throw new ApiError(404, "NOT_FOUND", `${name} not found`); return value; }

export async function registerRoutes(app: FastifyInstance, service: PlatformService, defaultTenantId: string): Promise<void> {
  app.get("/health", async () => ({ status: "ok", database: "sqlite", version: "1.0.0", timestamp: new Date().toISOString() }));
  app.get("/api/v1/dashboard", async (request) => service.dashboard(tenant(request, defaultTenantId)));

  const resources = ["investigations", "detection_rules", "hunts", "connectors", "remediations"] as const;
  const paths = { investigations: "investigations", detection_rules: "detection-rules", hunts: "hunts", connectors: "connectors", remediations: "remediations" } as const;
  for (const resource of resources) {
    const path = `/api/v1/${paths[resource]}`;
    app.get(path, { schema: { querystring: ListQuery } }, async (request) => ({ items: service.list(resource, tenant(request, defaultTenantId), request.query as Record<string, never>) }));
    app.post(path, { schema: { body: CreateSchemas[resource] } }, async (request, reply) => reply.code(201).send(service.create(resource, tenant(request, defaultTenantId), request.body as Record<string, unknown>)));
    app.get(`${path}/:id`, { schema: { params: IdParams } }, async (request) => {
      const { id } = request.params as { id: string };
      return required(resource === "investigations" ? service.investigationDetail(tenant(request, defaultTenantId), id) : service.get(resource, tenant(request, defaultTenantId), id), resource);
    });
    app.patch(`${path}/:id`, { schema: { params: IdParams, body: Body } }, async (request) => {
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
}
