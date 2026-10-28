import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { OperatorCredential } from "./auth.js";

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  defaultTenantId: string;
  workerEnabled: boolean;
  workerIntervalMs: number;
  authMode: "local" | "token";
  operatorCredentials: OperatorCredential[];
  secureCookies: boolean;
  appOrigins: string[];
  sessionTtlMs: number;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const authMode = overrides.authMode ?? process.env.AUTH_MODE ?? "local";
  if (authMode !== "local" && authMode !== "token") throw new Error("AUTH_MODE must be local or token");
  if (process.env.NODE_ENV === "production" && authMode !== "token") throw new Error("Production requires AUTH_MODE=token");
  const operatorCredentials: OperatorCredential[] = overrides.operatorCredentials ?? (process.env.AUTH_OPERATORS_FILE ? JSON.parse(readFileSync(process.env.AUTH_OPERATORS_FILE, "utf8")) : []);
  if (!Array.isArray(operatorCredentials) || operatorCredentials.length > 100 || operatorCredentials.some(item => !item || typeof item.id !== "string" || !item.id.trim() || typeof item.tenant_id !== "string" || !item.tenant_id.trim() || typeof item.token_hash !== "string" || !/^[a-f0-9]{64}$/.test(item.token_hash))) throw new Error("Invalid operator credential configuration");
  if (new Set(operatorCredentials.map(c => c.id)).size !== operatorCredentials.length || new Set(operatorCredentials.map(c => c.token_hash)).size !== operatorCredentials.length) throw new Error("Operator IDs and token hashes must be unique");
  if (authMode === "token" && !operatorCredentials.length) throw new Error("Token mode requires operator credentials");
  const appOrigins = overrides.appOrigins ?? (process.env.APP_ORIGINS || "http://localhost:8080,http://127.0.0.1:8080").split(",");
  for (const origin of appOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) throw new Error("APP_ORIGINS must contain exact HTTP(S) origins");
  }
  const secureCookies = overrides.secureCookies ?? process.env.NODE_ENV === "production";
  const sessionTtlMs = overrides.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 24 * 60 * 60 * 1000) throw new Error("Session lifetime must be between one second and 24 hours");
  if (process.env.NODE_ENV === "production" && (!secureCookies || appOrigins.some(origin => !origin.startsWith("https://")))) throw new Error("Production requires secure cookies and HTTPS origins");
  return {
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: overrides.port ?? Number(process.env.PORT ?? 3002),
    databasePath: overrides.databasePath ?? process.env.DATABASE_PATH ?? resolve("data/sqlite.db"),
    defaultTenantId: overrides.defaultTenantId ?? process.env.DEFAULT_TENANT_ID ?? "demo",
    workerEnabled: overrides.workerEnabled ?? (process.env.WORKER_ENABLED !== "false" && process.env.NODE_ENV !== "test"),
    workerIntervalMs: overrides.workerIntervalMs ?? 1500,
    authMode, operatorCredentials, secureCookies, appOrigins,
    sessionTtlMs
  };
}
