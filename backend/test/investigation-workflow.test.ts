import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";

test("rule configuration persists across restart with tenant-scoped history and validation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aisoc-workflow-"));
  const databasePath = join(dir, "test.db");
  let app = await buildApp({ databasePath });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/detection-rules", payload: { name: "New test rule", severity: "high", enabled: false, query: "process.name = powershell", schedule: "Every 10 minutes", routing: "Escalate" } });
    assert.equal(created.statusCode, 201);
    const id = created.json().id;
    const url = `/api/v1/detection-rules/${id}`;
    const patched = await app.inject({ method: "PATCH", url, payload: { query: "process.name = cmd", lookback_window: "30 minutes", routing: "Suppress" } });
    assert.equal(patched.statusCode, 200);
    for (const payload of [{ routing: "invalid" }, { severity: "urgent" }, { name: "  " }, { query: { invalid: true } }]) {
      assert.equal((await app.inject({ method: "PATCH", url, payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: "PATCH", url, headers: { "x-tenant-id": "other" }, payload: { name: "Stolen" } })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `${url}/history`, headers: { "x-tenant-id": "other" } })).statusCode, 404);
    await app.close();
    app = await buildApp({ databasePath });
    const stored = (await app.inject({ method: "GET", url })).json();
    assert.equal(stored.query, "process.name = cmd");
    assert.equal(stored.schedule, "Every 10 minutes");
    assert.equal(stored.routing, "Suppress");
    assert.equal(stored.enabled, false);
    const history = (await app.inject({ method: "GET", url: `${url}/history` })).json().items;
    assert.deepEqual(history.map((e: { action: string }) => e.action), ["updated", "created"]);
    const seeded = (await app.inject({ method: "GET", url: "/api/v1/investigations/INV-4819" })).json();
    assert.equal(seeded.steps.length, 1, "migration does not duplicate evidence on restart");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("case evidence and feedback stay scoped, persist, and cascade on deletion", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  try {
    const headers = { "x-tenant-id": "case-team" };
    const created = await app.inject({ method: "POST", url: "/api/v1/investigations", headers, payload: { title: "Review alert", source: "Test", severity: "medium" } });
    assert.equal(created.statusCode, 201);
    const url = `/api/v1/investigations/${created.json().id}`;
    const evidence = await app.inject({ method: "POST", url: `${url}/artifacts`, headers, payload: { type: "domain", value: "example.test", label: "Analyst observation" } });
    assert.equal(evidence.statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: `${url}/feedback`, headers, payload: { comment: "Reviewed the source evidence" } })).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: `${url}/feedback`, headers, payload: { comment: "   " } })).statusCode, 400);
    for (const action of ["feedback", "artifacts"]) {
      assert.equal((await app.inject({ method: "POST", url: `${url}/${action}`, payload: action === "feedback" ? { comment: "Foreign" } : { type: "ip", value: "192.0.2.1" } })).statusCode, 404);
    }
    const detail = (await app.inject({ method: "GET", url, headers })).json();
    assert.equal(detail.artifacts.length, 1);
    assert.equal(detail.feedback.length, 1);
    assert.equal(detail.steps.length, 0, "new cases never inherit demo transcripts");
    assert.deepEqual(detail.history.map((e: { action: string }) => e.action).sort(), ["created", "evidence_added", "feedback_added"]);
    await app.inject({ method: "POST", url: `${url}/determination`, headers, payload: { determination: "benign" } });
    const reopened = await app.inject({ method: "POST", url: `${url}/reinvestigate`, headers });
    assert.equal(reopened.json().determination, "unknown");
    assert.equal(reopened.json().replay_count, 1);
    assert.equal((await app.inject({ method: "GET", url, headers })).json().artifacts.length, 1);
    assert.equal((await app.inject({ method: "DELETE", url, headers })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url, headers })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: `${url}/feedback`, headers, payload: { comment: "Deleted case" } })).statusCode, 404);
  } finally { await app.close(); }
});
