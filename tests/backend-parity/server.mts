import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../../backend/src/app.js";
// This executable is only launched by the isolated test harness.
// Offline fixture setup for expiry that otherwise requires waiting a full day.
if (process.env.AISOC_TEST_EXPIRE_SOURCE) {
  const fixture = new DatabaseSync(process.env.AISOC_TEST_DB!);
  try { fixture.prepare("UPDATE api_sources SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", process.env.AISOC_TEST_EXPIRE_SOURCE); }
  finally { fixture.close(); }
}
const app = await buildApp({
  databasePath: process.env.AISOC_TEST_DB!,
  authMode: process.env.AISOC_TEST_AUTH === "token" ? "token" : "local",
  operatorCredentials: process.env.AISOC_TEST_AUTH === "token" ? [
    { id: "fixture-a", tenant_id: "auth-a", token_hash: createHash("sha256").update("parity_fixture_" + "a".repeat(40)).digest("hex") },
    { id: "fixture-b", tenant_id: "auth-b", token_hash: createHash("sha256").update("parity_fixture_" + "b".repeat(40)).digest("hex") },
  ] : [],
  workerEnabled: process.env.AISOC_TEST_WORKER !== "false",
  workerIntervalMs: Number(process.env.AISOC_TEST_INTERVAL || 100),
  sessionTtlMs: Number(process.env.AISOC_TEST_SESSION_TTL || 28800000),
});
const url = await app.listen({host:"127.0.0.1",port:0});
process.send?.({url,pid:process.pid,worker_interval_ms:Math.max(100, Number(process.env.AISOC_TEST_INTERVAL || 100))});
let closing = false;
const close = async () => { if(closing)return; closing=true; await app.close(); process.exit(0); };
process.on("SIGTERM",close); process.on("SIGINT",close); process.on("disconnect",close);
