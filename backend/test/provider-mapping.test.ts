import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("API sources preview and persist native event mappings while normalized intake stays supported", async () => {
  const app = await buildApp({ databasePath: ":memory:", workerEnabled: false });
  try {
    const sourceResult = await app.inject({ method: "POST", url: "/api/v1/api-sources", payload: { name: "Native source", provider: "Custom EDR", rule_id: "RULE-001" } });
    assert.equal(sourceResult.statusCode, 201);
    const { source, api_key: key } = sourceResult.json();
    assert.equal(source.mapping_json, undefined);
    const operatorHeaders = { "x-tenant-id": "demo" };
    const sourceHeaders = { authorization: `Bearer ${key}` };
    const mapping = {
      fields: {
        external_id: "event.id", title: "event.name", severity: "event.risk",
        summary: "event.description", category: "event.category", primary_entity: "event.host",
        evidence: "event.indicators"
      },
      severity_map: { sev1: "critical", sev2: "high", sev3: "medium", sev4: "low" }
    };
    const sample = { event: {
      id: "edr-101", name: "Suspicious process", risk: "Sev1", description: "Unsigned process launched",
      category: "endpoint", host: "ws-01", indicators: [{ type: "file", value: "bad.exe", label: "Image" }]
    } };
    const preview = await app.inject({ method: "POST", url: `/api/v1/api-sources/${source.id}/mapping/preview`, headers: operatorHeaders, payload: { mapping, sample } });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().valid, true);
    assert.equal(preview.json().normalized_alert.source, `api-source:${source.id}`);
    assert.equal(preview.json().normalized_alert.rule_id, "RULE-001");
    assert.equal(preview.json().normalized_alert.severity, "critical");
    assert.equal(preview.json().normalized_alert.evidence[0].value, "bad.exe");

    const before = await app.inject({ url: `/api/v1/api-sources/${source.id}`, headers: operatorHeaders });
    assert.deepEqual(before.json().mapping, { fields: {} }, "preview must not persist mapping changes");
    const saved = await app.inject({ method: "PATCH", url: `/api/v1/api-sources/${source.id}/mapping`, headers: operatorHeaders, payload: { mapping } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().mapping.fields.external_id, "event.id");

    const received = await app.inject({ method: "POST", url: source.native_intake_path, headers: sourceHeaders, payload: sample });
    assert.equal(received.statusCode, 201);
    assert.equal(received.json().alert.external_id, "edr-101");
    assert.equal(received.json().alert.source, `api-source:${source.id}`);
    assert.equal(received.json().alert.rule_id, "RULE-001");
    assert.equal(received.json().alert.payload.evidence[0].value, "bad.exe");

    const normalized = await app.inject({ method: "POST", url: source.intake_path, headers: sourceHeaders, payload: { external_id: "normalized-1", title: "Already normalized", severity: "medium" } });
    assert.equal(normalized.statusCode, 201, "existing normalized intake continues to work");
  } finally { await app.close(); }
});

test("native mapping preview reports missing required fields and rejects unsafe paths", async () => {
  const app = await buildApp({ databasePath: ":memory:", workerEnabled: false });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/api-sources", payload: { name: "Preview source", provider: "custom", rule_id: "RULE-001" } });
    const sourceId = created.json().source.id;
    const preview = await app.inject({ method: "POST", url: `/api/v1/api-sources/${sourceId}/mapping/preview`, payload: {
      mapping: { fields: { external_id: "id", title: "name", severity: "risk" } }, sample: { id: "x", name: "Missing severity" }
    } });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().valid, false);
    assert.ok(preview.json().errors.some((error: string) => error.includes("severity")));

    const invalid = await app.inject({ method: "PATCH", url: `/api/v1/api-sources/${sourceId}/mapping`, payload: {
      mapping: { fields: { external_id: "__proto__.id", title: "name", severity: "risk" } }
    } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "INVALID_EVENT_MAPPING");
  } finally { await app.close(); }
});
