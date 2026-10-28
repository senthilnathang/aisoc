import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { tokenHash } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase } from "../src/database.js";
import { Store } from "../src/repositories/store.js";
import { ApiSources } from "../src/services/api-sources.js";

const operatorToken = "test_operator_" + "a".repeat(40);
const foreignToken = "test_operator_" + "b".repeat(40);
const headers = { authorization: `Bearer ${operatorToken}` };
const foreignHeaders = { authorization: `Bearer ${foreignToken}` };
const credentials = [
  { id: "analyst-demo", tenant_id: "demo", token_hash: tokenHash(operatorToken) },
  { id: "analyst-other", tenant_id: "other", token_hash: tokenHash(foreignToken) }
];
const createApp = () => buildApp({ databasePath: ":memory:", authMode: "token", operatorCredentials: credentials, workerEnabled: false });

test("token mode fails closed and binds all API requests to the operator tenant", async () => {
  assert.throws(() => loadConfig({ authMode: "token", operatorCredentials: [] }), /requires operator credentials/);
  assert.throws(() => loadConfig({ operatorCredentials: [credentials[0]!, credentials[0]!] }), /unique/);
  const app = await createApp();
  try {
    assert.equal((await app.inject("/health")).statusCode, 200);
    assert.equal((await app.inject("/api/v1/auth/session")).json().authenticated, false);
    for (const url of ["/api/v1/dashboard", "/api/v1/investigations", "/api/v1/alerts", "/api/v1/api-sources", "/api/v1/connectors"]) {
      assert.equal((await app.inject({ url })).statusCode, 401);
      assert.equal((await app.inject({ url, headers: { authorization: "Bearer " + "x".repeat(50) } })).statusCode, 401);
      assert.equal((await app.inject({ url, headers: { ...headers, "x-tenant-id": "other" } })).statusCode, 403);
      assert.equal((await app.inject({ url, headers })).statusCode, 200);
    }
    assert.equal((await app.inject({ url: "/api/v1/investigations/INV-4819", headers: foreignHeaders })).statusCode, 404);
    assert.deepEqual((await app.inject({ url: "/api/v1/investigations", headers: foreignHeaders })).json().items, []);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload: {} })).statusCode, 401);
  } finally { await app.close(); }
});

test("operator sessions require CSRF for mutations, reject foreign origins, and revoke on logout", async () => {
  const app = await createApp();
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, origin: "http://localhost:8080" } });
    assert.equal(login.statusCode, 200);
    assert.match(String(login.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const csrf = login.json().csrf_token;
    assert.ok(csrf);
    assert.ok(!login.body.includes(operatorToken));
    const session = await app.inject({ url: "/api/v1/auth/session", headers: { cookie } });
    assert.equal(session.json().tenant_id, "demo");
    assert.equal(session.headers["cache-control"], "no-store");
    assert.equal((await app.inject({ url: "/api/v1/dashboard", headers: { cookie } })).statusCode, 200);
    const url = "/api/v1/detection-rules/RULE-001/toggle";
    assert.equal((await app.inject({ method: "POST", url, headers: { cookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url, headers: { cookie, "x-csrf-token": "wrong" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url, headers: { cookie, "x-csrf-token": csrf, origin: "https://foreign.example" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url, headers: { cookie, "x-csrf-token": csrf, origin: "http://localhost:8080" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, origin: "https://foreign.example" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie, "x-csrf-token": csrf } })).statusCode, 204);
    assert.equal((await app.inject({ url: "/api/v1/dashboard", headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/v1/auth/session", headers: { cookie } })).json().authenticated, false);
  } finally { await app.close(); }
});

test("API sources accept normalized alerts with a scoped key; rotation and revocation apply immediately", async () => {
  const app = await createApp();
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/api-sources", headers, payload: { name: "Hybrid SIEM", provider: "custom-provider", rule_id: "RULE-001" } });
    assert.equal(created.statusCode, 201);
    const { source, api_key } = created.json();
    assert.ok(api_key);
    assert.equal(source.format, "normalized-alert-v1");
    assert.equal(source.key_hash, undefined);
    assert.equal(created.headers["cache-control"], "no-store");
    const payload = { external_id: "native-event-1", title: "Provider alert", severity: "high", primary_entity: "host-1", evidence: [{ type: "domain", value: "example.test" }] };
    const ingestHeaders = { authorization: `Bearer ${api_key}` };
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, payload })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, headers, payload })).statusCode, 401, "operator key is not an intake key");
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, headers: { ...ingestHeaders, "x-tenant-id": "other" }, payload })).statusCode, 403);
    const received = await app.inject({ method: "POST", url: source.intake_path, headers: ingestHeaders, payload: { ...payload, source: "forged", rule_id: "RULE-003" } });
    assert.equal(received.statusCode, 201);
    assert.equal(received.json().alert.rule_id, "RULE-001");
    assert.equal(received.json().alert.source, `api-source:${source.id}`);
    assert.equal(received.json().alert.tenant_id, "demo");
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, headers: ingestHeaders, payload })).statusCode, 200);
    for (const url of ["/api/v1/api-sources", "/api/v1/dashboard", "/api/v1/investigations", "/api/v1/alerts"]) {
      assert.equal((await app.inject({ url, headers: ingestHeaders })).statusCode, 401, "intake key cannot read operator data");
    }
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", headers: ingestHeaders, payload: {} })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: ingestHeaders })).statusCode, 401);
    const listed = await app.inject({ url: "/api/v1/api-sources", headers });
    assert.ok(!listed.body.includes(api_key));
    assert.ok(!listed.body.includes("key_hash"));
    assert.equal((await app.inject({ url: `/api/v1/api-sources/${source.id}`, headers: foreignHeaders })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/api-sources/${source.id}/rotate-key`, headers: foreignHeaders, payload: {} })).statusCode, 404);
    const rotated = await app.inject({ method: "POST", url: `/api/v1/api-sources/${source.id}/rotate-key`, headers, payload: {} });
    assert.equal(rotated.statusCode, 200);
    assert.notEqual(rotated.json().api_key, api_key);
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, headers: ingestHeaders, payload })).statusCode, 401);
    const newHeaders = { authorization: `Bearer ${rotated.json().api_key}` };
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, headers: newHeaders, payload })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/api-sources/${source.id}/revoke`, headers })).json().status, "revoked");
    assert.equal((await app.inject({ method: "POST", url: source.intake_path, headers: newHeaders, payload })).statusCode, 401);
  } finally { await app.close(); }
});

test("expired operator sessions are rejected and expired source keys cannot authenticate", async () => {
  const app = await buildApp({ databasePath: ":memory:", authMode: "token", operatorCredentials: credentials, sessionTtlMs: 1000, workerEnabled: false });
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    await delay(1100);
    assert.equal((await app.inject({ url: "/api/v1/dashboard", headers: { cookie } })).statusCode, 401);
  } finally { await app.close(); }
  const db = openDatabase(":memory:");
  try {
    const sources = new ApiSources(db, new Store(db));
    const issued = sources.create("demo", { name: "Expiring", provider: "generic", rule_id: "RULE-001", expires_in_days: 1 }, "analyst-demo");
    assert.ok(sources.authenticate(issued.source.id, issued.api_key));
    db.prepare("UPDATE api_sources SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", issued.source.id);
    assert.equal(sources.authenticate(issued.source.id, issued.api_key), undefined);
    assert.equal(sources.get("demo", issued.source.id)!.status, "expired");
    assert.ok(!JSON.stringify(sources.list("demo")).includes(issued.api_key));
  } finally { db.close(); }
});
