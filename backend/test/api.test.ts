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

test("threat intel report CRUD and launch hunt", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const created = await app.inject({ method: "POST", url: "/api/v1/threat-intel-reports", payload: { title: "APT29 Campaign", summary: "Cozy Bear phishing wave", source: "CISA", report_type: "threat_report", severity: "critical", ioc_count: 5, tags: ["apt29", "phishing"], published_at: "2026-10-01" } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;

  const detail = await app.inject({ method: "GET", url: `/api/v1/threat-intel-reports/${id}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().title, "APT29 Campaign");
  assert.ok(Array.isArray(detail.json().indicators));

  const hunted = await app.inject({ method: "POST", url: `/api/v1/threat-intel-reports/${id}/launch-hunt` });
  assert.equal(hunted.statusCode, 200);
  assert.equal(hunted.json().hunt_status, "hunting");
  assert.equal(hunted.json().hunts_launched, 1);
  await app.close();
});

test("threat indicator CRUD and report linkage", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const report = await app.inject({ method: "POST", url: "/api/v1/threat-intel-reports", payload: { title: "IOC Test", source: "Unit Test", severity: "high" } });
  const reportId = report.json().id;

  const indicator = await app.inject({ method: "POST", url: "/api/v1/threat-indicators", payload: { report_id: reportId, indicator_type: "ip", value: "198.51.100.42", severity: "high", hits: 3 } });
  assert.equal(indicator.statusCode, 201);
  assert.equal(indicator.json().indicator_type, "ip");

  const detail = await app.inject({ method: "GET", url: `/api/v1/threat-intel-reports/${reportId}` });
  assert.equal(detail.json().indicators.length, 1);
  assert.equal(detail.json().indicators[0].value, "198.51.100.42");
  await app.close();
});

test("threat intel dashboard aggregation", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  await app.inject({ method: "POST", url: "/api/v1/threat-intel-reports", payload: { title: "Report A", source: "CISA", severity: "high" } });
  await app.inject({ method: "POST", url: "/api/v1/threat-intel-reports", payload: { title: "Report B", source: "CISA", severity: "medium" } });
  await app.inject({ method: "POST", url: "/api/v1/threat-intel-reports", payload: { title: "Report C", source: "Mandiant", severity: "critical" } });

  const dashboard = await app.inject({ method: "GET", url: "/api/v1/threat-intel/dashboard" });
  assert.equal(dashboard.statusCode, 200);
  const data = dashboard.json();
  assert.ok(data.totalReports >= 3);
  assert.ok(data.reportsBySource.CISA >= 2);
  assert.ok(data.reportsBySource.Mandiant >= 1);
  await app.close();
});

test("detection rule toggle flips enabled state", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const created = await app.inject({ method: "POST", url: "/api/v1/detection-rules", payload: { name: "Toggle Test Rule", severity: "medium" } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  const initial = created.json().enabled;

  const toggled = await app.inject({ method: "POST", url: `/api/v1/detection-rules/${id}/toggle` });
  assert.equal(toggled.statusCode, 200);
  assert.equal(toggled.json().enabled, !initial);
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
