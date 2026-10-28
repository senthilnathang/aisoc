import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("Skills CRUD, scopes, publishing, and audit history stay tenant scoped", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const headers = { "x-tenant-id": "skills-tenant" };
  const created = await app.inject({ method: "POST", url: "/api/v1/skills", headers, payload: {
    name: "Review OAuth grants", description: "Check consent evidence", apply_when: "Identity alert",
    content_markdown: "1. Verify publisher", modules: ["investigations"], connectors: ["Microsoft 365"],
    alert_categories: ["identity"], insight_refs: ["policy:oauth"], tags: ["oauth", "identity"]
  } });
  assert.equal(created.statusCode, 201);
  const skill = created.json();
  assert.equal(skill.state, "draft");
  assert.deepEqual(skill.insight_refs, ["policy:oauth"]);

  const hidden = await app.inject({ method: "GET", url: `/api/v1/skills/${skill.id}`, headers: { "x-tenant-id": "other-tenant" } });
  assert.equal(hidden.statusCode, 404);
  const found = await app.inject({ method: "GET", url: "/api/v1/skills?search=oauth&module=investigations&state=draft", headers });
  assert.equal(found.json().total, 1);

  const published = await app.inject({ method: "POST", url: `/api/v1/skills/${skill.id}/publish`, headers });
  assert.equal(published.statusCode, 200);
  assert.equal(published.json().state, "published");
  assert.equal(published.json().enabled, true);
  const history = await app.inject({ method: "GET", url: `/api/v1/skills/${skill.id}/history`, headers });
  assert.ok(history.json().items.some((event: { action: string }) => event.action === "published"));
  await app.close();
});

test("Skill reference materials enforce size/type rules and retain immutable versions", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const headers = { "x-tenant-id": "materials-tenant" };
  const skill = await app.inject({ method: "POST", url: "/api/v1/skills", headers, payload: { name: "Material test" } });
  const id = skill.json().id;
  const created = await app.inject({ method: "POST", url: `/api/v1/skills/${id}/materials`, headers, payload: {
    name: "Checklist", filename: "review.md", kind: "checklist", content: "Check identity and evidence"
  } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().version, 1);
  const materialId = created.json().id;

  const updated = await app.inject({ method: "PATCH", url: `/api/v1/skills/${id}/materials/${materialId}`, headers, payload: { content: "Check identity, device, and evidence" } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().version, 2);
  const versions = await app.inject({ method: "GET", url: `/api/v1/skills/${id}/materials/${materialId}/versions`, headers });
  assert.deepEqual(versions.json().items.map((item: { version: number }) => item.version), [2, 1]);

  const invalidType = await app.inject({ method: "POST", url: `/api/v1/skills/${id}/materials`, headers, payload: { name: "Script", filename: "run.sh", content: "echo unsafe" } });
  assert.equal(invalidType.statusCode, 400);
  const oversized = await app.inject({ method: "POST", url: `/api/v1/skills/${id}/materials`, headers, payload: { name: "Large", filename: "large.txt", content: "x".repeat(128 * 1024 + 1) } });
  assert.equal(oversized.statusCode, 413);

  const archived = await app.inject({ method: "DELETE", url: `/api/v1/skills/${id}/materials/${materialId}`, headers });
  assert.equal(archived.statusCode, 204);
  const active = await app.inject({ method: "GET", url: `/api/v1/skills/${id}/materials`, headers });
  assert.equal(active.json().items.length, 0);
  await app.close();
});

test("HTTPS references reject non-HTTPS URLs", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  const skill = await app.inject({ method: "POST", url: "/api/v1/skills", payload: { name: "URL test" } });
  const response = await app.inject({ method: "POST", url: `/api/v1/skills/${skill.json().id}/materials`, payload: { name: "Unsafe link", source_url: "http://example.test/guide" } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_MATERIAL_URL");
  await app.close();
});
