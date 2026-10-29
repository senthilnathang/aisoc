import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { ApiError } from "./errors.js";
import { Store } from "./repositories/store.js";
import { registerRoutes } from "./routes.js";
import { PlatformService } from "./services/platform-service.js";
import { AlertPipeline } from "./services/alert-pipeline.js";
import { ApiSources } from "./services/api-sources.js";
import { Skills } from "./services/skills.js";
import { ResponsePlans, registerResponseRoutes } from "./response.js";
import { installAuth } from "./auth.js";

export async function buildApp(overrides: Partial<AppConfig> = {}, configure?: (app: FastifyInstance) => void): Promise<FastifyInstance> {
  const config = loadConfig(overrides);
  const database = openDatabase(config.databasePath);
  const store = new Store(database);
  const responsePlans = new ResponsePlans(database);
  const skills = new Skills(database, store);
  const pipeline = new AlertPipeline(database, store, skills);
  const service = new PlatformService(store, pipeline, skills);
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-csrf-token", "res.headers.set-cookie"] } });
  configure?.(app);
  const sources = new ApiSources(database, store);

  await app.register(cors, { origin: config.appOrigins, credentials: true });
  installAuth(app, config, sources);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    if (error instanceof Error && "validation" in error && error.validation) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: error.message, details: error.validation } });
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: error.statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST", message: error.message, details: null } });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", details: null } });
  });
  let workerTimer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    if (config.workerEnabled) {
      workerTimer = setInterval(() => {
        try { pipeline.processNext(); }
        catch (error) { app.log.error(error, "Local investigation worker tick failed"); }
      }, Math.max(100, config.workerIntervalMs));
      workerTimer.unref();
    }
  });
  app.addHook("onClose", async () => { if (workerTimer) clearInterval(workerTimer); store.close(); });
  registerResponseRoutes(app, responsePlans, config.defaultTenantId);
  await registerRoutes(app, service, config.defaultTenantId, pipeline, sources, skills);
  return app;
}
