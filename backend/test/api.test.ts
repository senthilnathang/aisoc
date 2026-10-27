import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("health and seeded dashboard are available", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().database, "sqlite");
  const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
  assert.equal(dashboard.statusCode, 200);
  assert.ok(dashboard.json().openInvestigations > 0);
  await app.close();
});

test("investigation CRUD and actions are tenant scoped", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const created = await app.inject({ method: "POST", url: "/api/v1/investigations", headers: { "x-tenant-id": "tenant-a" }, payload: { title: "Test alert", summary: "Local", source: "Test", category: "identity", severity: "high", status: "open", determination: "unknown", risk_score: 80, owner: "Analyst", primary_entity: "user@example.com" } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  const hidden = await app.inject({ method: "GET", url: `/api/v1/investigations/${id}`, headers: { "x-tenant-id": "tenant-b" } });
  assert.equal(hidden.statusCode, 404);
  const replay = await app.inject({ method: "POST", url: `/api/v1/investigations/${id}/reinvestigate`, headers: { "x-tenant-id": "tenant-a" } });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replay_count, 1);
  await app.close();
});

test("connector test and remediation execution update state", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const connector = await app.inject({ method: "POST", url: "/api/v1/connectors", payload: { type: "cribl", name: "Cribl", description: "Test", workspace_url: "https://example.cribl.cloud", client_id: "client", secret: "local" } });
  const tested = await app.inject({ method: "POST", url: `/api/v1/connectors/${connector.json().id}/test` });
  assert.equal(tested.json().status, "operational");
  const executed = await app.inject({ method: "POST", url: "/api/v1/remediations/REM-001/execute" });
  assert.equal(executed.json().status, "completed");
  await app.close();
});

test("invalid resources are rejected and connector secrets are redacted", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const invalid = await app.inject({ method: "POST", url: "/api/v1/investigations", payload: { title: "Missing required fields" } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "VALIDATION_ERROR");

  const connector = await app.inject({ method: "POST", url: "/api/v1/connectors", payload: { type: "cribl", name: "Secret test", workspace_url: "https://example.cribl.cloud", client_id: "client", secret: "must-not-leak" } });
  assert.equal(connector.statusCode, 201);
  assert.equal(connector.json().secret, undefined);
  assert.equal(connector.json().secret_ciphertext, undefined);

  for (const resource of ["investigations", "detection-rules", "hunts", "connectors", "remediations"]) {
    const response = await app.inject({ method: "GET", url: `/api/v1/${resource}?search=test` });
    assert.equal(response.statusCode, 200, `${resource} search should succeed`);
  }
  await app.close();
});
