import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { ApiError } from "./errors.js";
import { Store } from "./repositories/store.js";
import { registerRoutes } from "./routes.js";
import { PlatformService } from "./services/platform-service.js";

export async function buildApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config = loadConfig(overrides);
  const database = openDatabase(config.databasePath);
  const store = new Store(database);
  const service = new PlatformService(store);
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  await app.register(cors, { origin: ["http://localhost:8080", "http://127.0.0.1:8080"] });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    if (error instanceof Error && "validation" in error && error.validation) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: error.message, details: error.validation } });
    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", details: null } });
  });
  app.addHook("onClose", async () => store.close());
  await registerRoutes(app, service, config.defaultTenantId);
  return app;
}
