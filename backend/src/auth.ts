import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { ApiError } from "./errors.js";
import type { ApiSources } from "./services/api-sources.js";

export interface OperatorCredential { id: string; tenant_id: string; token_hash: string }
export interface Principal { id: string; tenant_id: string; kind: "operator" | "source" | "local" }
declare module "fastify" {
  interface FastifyRequest { principal: Principal | null }
  interface FastifyContextConfig { access?: "public" | "source" }
}
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalTokenHash(token: string, hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(hash, "hex"));
}
const unauthorized = () => new ApiError(401, "UNAUTHENTICATED", "A valid credential is required.");
function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;
  if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(header)) throw unauthorized();
  return header.slice(7);
}
function sessionCookie(request: FastifyRequest): string | undefined {
  const values = (request.headers.cookie || "").split(";").map(part => part.trim()).filter(part => part.startsWith("aisoc_session="));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice("aisoc_session=".length);
  return /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : undefined;
}
export function tenantFor(request: FastifyRequest, fallback: string): string {
  if (request.principal) return request.principal.tenant_id;
  const header = request.headers["x-tenant-id"];
  return typeof header === "string" && header.trim() ? header.trim() : fallback;
}

export function installAuth(app: FastifyInstance, config: AppConfig, sources: ApiSources): void {
  const sessions = new Map<string, { principal: Principal; csrf: string; expires: number }>();
  const cookie = (value: string, maxAge: number) => `aisoc_session=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
  const checkOrigin = (request: FastifyRequest) => {
    const origin = request.headers.origin;
    if (origin && !config.appOrigins.includes(origin)) throw new ApiError(403, "ORIGIN_DENIED", "This browser origin is not allowed.");
  };
  const operator = (token: string | undefined): Principal => {
    if (!token) throw unauthorized();
    const credential = config.operatorCredentials.find(item => equalTokenHash(token, item.token_hash));
    if (!credential) throw unauthorized();
    return { id: credential.id, tenant_id: credential.tenant_id, kind: "operator" };
  };
  const getSession = (request: FastifyRequest) => {
    const token = sessionCookie(request);
    const key = token ? tokenHash(token) : "";
    const session = sessions.get(key);
    if (!session) return undefined;
    if (session.expires <= Date.now()) { sessions.delete(key); return undefined; }
    return session;
  };
  const bindTenant = (request: FastifyRequest, principal: Principal) => {
    const claimed = request.headers["x-tenant-id"];
    if (claimed !== undefined && claimed !== principal.tenant_id) throw new ApiError(403, "TENANT_MISMATCH", "The credential does not authorize the requested tenant.");
    request.principal = principal;
  };
  app.decorateRequest("principal", null);
  app.addHook("onRequest", async request => {
    if (request.routeOptions.config.access === "public") return;
    if (request.routeOptions.config.access === "source") {
      const token = bearer(request);
      const sourceId = (request.params as { id: string }).id;
      const source = token ? sources.authenticate(sourceId, token) : undefined;
      if (!source) throw unauthorized();
      bindTenant(request, { id: source.id, tenant_id: source.tenant_id, kind: "source" });
      return;
    }
    if (config.authMode === "local") {
      // Never reinterpret a supplied invalid credential as anonymous demo access.
      const token = bearer(request);
      if (token) bindTenant(request, operator(token));
      return;
    }
    const token = bearer(request);
    if (token) { bindTenant(request, operator(token)); return; }
    const session = getSession(request);
    if (!session) throw unauthorized();
    bindTenant(request, session.principal);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      checkOrigin(request);
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || !equalTokenHash(csrf, tokenHash(session.csrf))) throw new ApiError(403, "CSRF_INVALID", "Refresh the session before making changes.");
    }
  });
  app.get("/api/v1/auth/session", { config: { access: "public" } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (config.authMode === "local") return { mode: "local", authenticated: true, tenant_id: config.defaultTenantId };
    const session = getSession(request);
    return session ? { mode: "token", authenticated: true, tenant_id: session.principal.tenant_id, operator_id: session.principal.id, csrf_token: session.csrf, expires_at: new Date(session.expires).toISOString() }
      : { mode: "token", authenticated: false };
  });
  app.post("/api/v1/auth/login", { config: { access: "public" } }, async (request, reply) => {
    checkOrigin(request);
    const principal = operator(bearer(request));
    bindTenant(request, principal);
    for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
    const old = sessionCookie(request);
    if (old) sessions.delete(tokenHash(old));
    if (sessions.size >= 1000) throw new ApiError(503, "SESSION_CAPACITY", "Session capacity reached. Try again later.");
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const expires = Date.now() + config.sessionTtlMs;
    sessions.set(tokenHash(token), { principal, csrf, expires });
    reply.header("Cache-Control", "no-store").header("Set-Cookie", cookie(token, Math.floor(config.sessionTtlMs / 1000)));
    return { mode: "token", authenticated: true, tenant_id: principal.tenant_id, operator_id: principal.id, csrf_token: csrf, expires_at: new Date(expires).toISOString() };
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = sessionCookie(request);
    if (token) sessions.delete(tokenHash(token));
    return reply.header("Set-Cookie", cookie("", 0)).code(204).send();
  });
  app.addHook("onClose", async () => sessions.clear());
}
