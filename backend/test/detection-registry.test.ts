import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";

test("registry filters, stable pagination, and source choices are tenant scoped", async () => {
  const app = await buildApp({ databasePath: ":memory:", workerEnabled: false });
  const headers = { "x-tenant-id": "registry-team" };
  try {
    for (const [name, severity, enabled] of [["Alpha", "high", true], ["Beta", "low", false], ["Gamma", "high", true]] as const) {
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/detection-rules", headers, payload: { name, severity, enabled } })).statusCode, 201);
    }
    const get = async (query: string) => (await app.inject({ url: `/api/v1/detection-registry?${query}`, headers })).json();
    const first = await get("sort=name&direction=asc&limit=1");
    const second = await get("sort=name&direction=asc&limit=1&offset=1");
    assert.equal(first.total, 3);
    assert.equal(first.items[0].name, "Alpha");
    assert.equal(second.items[0].name, "Beta");
    assert.equal((await get("severity=high&enabled=true")).total, 2);
    assert.equal((await get("search=BETA")).total, 1);
    assert.equal((await get("search=%25")).total, 0, "search treats SQL wildcard as literal text");
    assert.equal((await get("offset=999")).total, 3);
    assert.deepEqual((await get("offset=999")).items, []);
    assert.equal((await app.inject({ url: "/api/v1/detection-registry?sort=invalid", headers })).statusCode, 400);
    await app.inject({ method: "POST", url: "/api/v1/api-sources", headers, payload: { name: "Hybrid", provider: "private-provider", rule_id: first.items[0].id } });
    assert.equal((await get("source=private-provider")).total, 1);
    const other = (await app.inject({ url: "/api/v1/detection-registry", headers: { "x-tenant-id": "other" } })).json();
    assert.equal(other.total, 0); assert.deepEqual(other.sources, []);
  } finally { await app.close(); }
});

test("registry metrics count stored alerts and distinct cases, never seed counters or unknown false positives", async () => {
  const app = await buildApp({ databasePath: ":memory:", workerEnabled: false });
  try {
    const url = "/api/v1/detection-rules/RULE-001";
    const initial = (await app.inject(url)).json();
    assert.equal(initial.detections, 0); assert.equal(initial.investigations, 0); assert.equal(initial.false_positive_rate, null);
    const payload = { source: "Custom sensor", external_id: "registry-event", rule_id: "RULE-001", title: "Observed event", severity: "low" };
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload })).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload })).statusCode, 200);
    await app.inject({ method: "PATCH", url, payload: { routing: "Suppress" } });
    await app.inject({ method: "POST", url: "/api/v1/alerts", payload: { ...payload, external_id: "suppressed-event" } });
    const detail = (await app.inject(url)).json();
    assert.equal(detail.detections, 2); assert.equal(detail.investigations, 1); assert.equal(detail.suppressed, 1);
    assert.deepEqual(detail.outcomes, [{ determination: "unknown", count: 1 }]);
    assert.equal(detail.false_positive_rate, null);
    assert.deepEqual(detail.sources, ["Custom sensor"]);
    const list = (await app.inject("/api/v1/detection-registry?source=Custom%20sensor&sort=detections")).json();
    assert.equal(list.total, 1); assert.equal(list.items[0].detections, 2);
    assert.equal((await app.inject({ method: "DELETE", url })).statusCode, 409);
  } finally { await app.close(); }
});

test("rule snapshots persist, stale writes fail atomically, and clones start disabled without bindings or counters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aisoc-registry-"));
  const databasePath = join(dir, "test.db");
  let app = await buildApp({ databasePath, workerEnabled: false });
  try {
    const url = "/api/v1/detection-rules/RULE-001";
    const initial = (await app.inject(url)).json();
    assert.equal(initial.version, 1);
    assert.equal((await app.inject({ method: "PATCH", url, payload: { query: "event.action = 'login'", expected_version: 1 } })).statusCode, 200);
    assert.equal((await app.inject({ method: "PATCH", url, payload: { query: "stale", expected_version: 1 } })).statusCode, 409);
    const current = (await app.inject(url)).json();
    assert.equal(current.version, 2); assert.equal(current.versions.length, 2);
    assert.equal(current.versions[1].snapshot.query, initial.query);
    assert.equal(current.versions[0].snapshot.query, "event.action = 'login'");
    assert.equal(current.history.length, 1, "conflicting mutation has no audit side effect");
    await app.inject({ method: "PATCH", url, payload: { query: "event.action = 'login'", expected_version: 2 } });
    assert.equal((await app.inject(url)).json().version, 2, "no-op configuration does not create another version");
    const cloned = await app.inject({ method: "POST", url: `${url}/clone` });
    assert.equal(cloned.statusCode, 201);
    const cloneUrl = `/api/v1/detection-rules/${cloned.json().id}`;
    const clone = (await app.inject(cloneUrl)).json();
    assert.equal(clone.enabled, false); assert.equal(clone.query, current.query);
    assert.equal(clone.detections, 0); assert.equal(clone.version, 1); assert.deepEqual(clone.bindings, []);
    for (const target of [url, cloneUrl]) {
      assert.equal((await app.inject({ url: target, headers: { "x-tenant-id": "other" } })).statusCode, 404);
      assert.equal((await app.inject({ method: "POST", url: `${target}/clone`, headers: { "x-tenant-id": "other" } })).statusCode, 404);
    }
    await app.close(); app = await buildApp({ databasePath, workerEnabled: false });
    const persisted = (await app.inject(url)).json();
    assert.equal(persisted.version, 2); assert.equal(persisted.versions.length, 2);
    assert.equal((await app.inject({ method: "DELETE", url: cloneUrl })).statusCode, 204);
    assert.equal((await app.inject(cloneUrl)).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
