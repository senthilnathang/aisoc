import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  defaultTenantId: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: overrides.port ?? Number(process.env.PORT ?? 3002),
    databasePath: overrides.databasePath ?? process.env.DATABASE_PATH ?? resolve("data/sqlite.db"),
    defaultTenantId: overrides.defaultTenantId ?? process.env.DEFAULT_TENANT_ID ?? "demo"
  };
}
