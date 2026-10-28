import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase } from "../src/database.js";
import { Store } from "../src/repositories/store.js";
import { AlertPipeline, type AlertInput } from "../src/services/alert-pipeline.js";

const input = { source: "Local sensor", external_id: "event-1", rule_id: "RULE-001", title: "Suspicious connection", severity: "high", primary_entity: "device-1", evidence: [{ type: "domain", value: "crx-update.cloudgateway.cc" }] };

test("ingestion atomically links one alert, case and job; retries do not inflate counters", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  try {
    const before = (await app.inject("/api/v1/detection-rules/RULE-001")).json();
    const results = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: "POST", url: "/api/v1/alerts", payload: input })));
    assert.equal(results.filter(r => r.statusCode === 201).length, 1);
    assert.equal(results.filter(r => r.statusCode === 200).length, 7);
    const alert = results[0]!.json().alert;
    assert.ok(results.every(r => r.json().alert.id === alert.id));
    const detail = (await app.inject(`/api/v1/investigations/${alert.investigation_id}`)).json();
    assert.equal(detail.alerts.length, 1);
    assert.equal(detail.jobs.length, 1);
    assert.equal(detail.jobs[0].status, "queued");
    assert.equal(detail.determination, "unknown");
    const rule = (await app.inject("/api/v1/detection-rules/RULE-001")).json();
    assert.equal(rule.detections, before.detections + 1);
    assert.equal(rule.investigations, before.investigations + 1);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload: { ...input, title: "Conflicting retry" } })).statusCode, 409);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/investigations/${alert.investigation_id}` })).statusCode, 409);
    assert.equal((await app.inject({ method: "DELETE", url: "/api/v1/detection-rules/RULE-001" })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/investigations/${alert.investigation_id}/reinvestigate` })).statusCode, 409);
  } finally { await app.close(); }
});

test("ingestion rejects invalid and foreign rules; suppression retains alerts without creating cases", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  try {
    for (const payload of [{ ...input, source: "  " }, { ...input, severity: "urgent" }, { ...input, evidence: [{ type: "domain", value: " " }] }]) {
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", headers: { "content-type": "application/json" }, payload: "{" })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload: { ...input, summary: "x".repeat(140000) } })).statusCode, 413);
    const headers = { "x-tenant-id": "other" };
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", headers, payload: input })).statusCode, 404);
    await app.inject({ method: "PATCH", url: "/api/v1/detection-rules/RULE-001", payload: { enabled: false } });
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload: input })).statusCode, 409);
    await app.inject({ method: "PATCH", url: "/api/v1/detection-rules/RULE-001", payload: { enabled: true, routing: "Suppress" } });
    const result = await app.inject({ method: "POST", url: "/api/v1/alerts", payload: input });
    assert.equal(result.statusCode, 201);
    assert.equal(result.json().alert.disposition, "suppressed");
    assert.equal(result.json().alert.investigation_id, null);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/alerts/${result.json().alert.id}`, headers })).statusCode, 404);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/alerts", headers })).json().items, []);
    const queue = (await app.inject({ method: "GET", url: "/api/v1/investigation-queue", headers })).json();
    assert.deepEqual(queue.items, []);
    assert.deepEqual(queue.summary, { alerts: 0, active_runs: 0, open_cases: 0 });
    await app.inject({ method: "PATCH", url: "/api/v1/detection-rules/RULE-001", payload: { enabled: false } });
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/alerts", payload: input })).statusCode, 200, "exact retry stays idempotent even after rule changes");
  } finally { await app.close(); }
});

test("worker resumes committed phases after restart without duplicate evidence or steps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aisoc-pipeline-"));
  const path = join(dir, "workflow.db");
  let db = openDatabase(path);
  try {
    let store = new Store(db);
    let pipeline = new AlertPipeline(db, store);
    const alert = pipeline.ingest("demo", input as AlertInput).alert;
    const id = alert.investigation_id!;
    assert.equal(pipeline.processNext(), true);
    assert.equal(pipeline.context("demo", id).jobs[0]!.phase, 1);
    assert.equal(store.list("artifacts", "demo", { investigationId: id }).length, 2);
    db.close();
    db = openDatabase(path);
    store = new Store(db);
    pipeline = new AlertPipeline(db, store);
    pipeline.processNext();
    pipeline.processNext();
    assert.equal(pipeline.processNext(), false);
    assert.equal(pipeline.context("demo", id).jobs[0]!.status, "completed");
    assert.equal(store.get("investigations", "demo", id)!.determination, "suspicious");
    assert.equal(store.get("investigations", "demo", id)!.status, "open");
    const steps = store.list("investigation_steps", "demo", { investigationId: id });
    assert.equal(steps.length, 3);
    assert.equal(steps[0]!.title, "Record supplied evidence");
    assert.equal((steps[1]!.response as { matches: unknown[] }).matches.length, 1);
    assert.equal(store.list("artifacts", "demo", { investigationId: id }).length, 2);
    assert.equal(pipeline.ingest("demo", input as AlertInput).duplicate, true);
    store.transaction(() => pipeline.requeue("demo", id));
    for (let i = 0; i < 3; i++) pipeline.processNext();
    assert.equal(store.list("investigation_steps", "demo", { investigationId: id }).length, 6);
    assert.equal(store.list("artifacts", "demo", { investigationId: id }).length, 2, "replays reuse imported artifacts");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("failed intake leaves no orphan case, job, counter change or audit event", () => {
  const db = openDatabase(":memory:");
  try {
    const store = new Store(db);
    const pipeline = new AlertPipeline(db, store);
    const beforeCases = store.count("investigations", "demo");
    const beforeRule = store.get("detection_rules", "demo", "RULE-001");
    db.exec("CREATE TRIGGER fail_alert BEFORE INSERT ON alerts BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.throws(() => pipeline.ingest("demo", input as AlertInput));
    assert.equal(store.count("investigations", "demo"), beforeCases);
    assert.equal(store.count("alerts", "demo"), 0);
    assert.equal(store.count("investigation_jobs", "demo"), 0);
    assert.equal(store.count("audit_events", "demo"), 0);
    assert.deepEqual(store.get("detection_rules", "demo", "RULE-001"), beforeRule);
  } finally { db.close(); }
});

test("worker rolls back a failed phase, records failure, and succeeds on an explicit retry", () => {
  const db = openDatabase(":memory:");
  try {
    const store = new Store(db);
    const pipeline = new AlertPipeline(db, store);
    const id = pipeline.ingest("demo", input as AlertInput).alert.investigation_id!;
    db.exec("CREATE TRIGGER fail_step BEFORE INSERT ON investigation_steps BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    pipeline.processNext();
    assert.equal(pipeline.context("demo", id).jobs[0]!.status, "failed");
    assert.equal(pipeline.context("demo", id).jobs[0]!.phase, 0);
    assert.equal(store.list("artifacts", "demo", { investigationId: id }).length, 0);
    assert.equal(store.list("investigation_steps", "demo", { investigationId: id }).length, 0);
    assert.equal(pipeline.processNext(), false, "failed jobs are not retried automatically");
    db.exec("DROP TRIGGER fail_step");
    store.transaction(() => pipeline.requeue("demo", id));
    for (let i = 0; i < 3; i++) pipeline.processNext();
    assert.equal(pipeline.context("demo", id).jobs[0]!.status, "completed");
  } finally { db.close(); }
});

test("background worker completes a low-severity alert without inventing a benign verdict", async () => {
  const app = await buildApp({ databasePath: ":memory:", workerEnabled: true, workerIntervalMs: 100 });
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/alerts", payload: { ...input, severity: "low", evidence: [] } });
    const id = response.json().alert.investigation_id;
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/investigations/${id}/determination`, payload: { determination: "benign" } })).statusCode, 409);
    let detail = (await app.inject(`/api/v1/investigations/${id}`)).json();
    for (let i = 0; i < 30 && detail.jobs[0].status !== "completed"; i++) {
      await delay(100);
      detail = (await app.inject(`/api/v1/investigations/${id}`)).json();
    }
    assert.equal(detail.jobs[0].status, "completed");
    assert.equal(detail.determination, "unknown");
    assert.equal(detail.steps.length, 3);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/investigations/${id}/determination`, payload: { determination: "benign" } })).statusCode, 200);
    await delay(150);
    assert.equal((await app.inject(`/api/v1/investigations/${id}`)).json().determination, "benign");
  } finally { await app.close(); }
});

test("sampling is deterministic and local correlation cannot read another tenant's indicators", () => {
  const db = openDatabase(":memory:");
  try {
    const store = new Store(db);
    const pipeline = new AlertPipeline(db, store);
    store.create("detection_rules", "other", { id: "RULE-001", name: "Other rule", severity: "low", routing: "Sample (10%)" });
    let sampled = 0;
    let skipped = 0;
    for (let i = 0; i < 100; i++) {
      const payload = { ...input, external_id: `sample-${i}`, severity: "low" } as AlertInput;
      const first = pipeline.ingest("other", payload).alert;
      const retry = pipeline.ingest("other", payload);
      assert.equal(retry.duplicate, true);
      assert.equal(retry.alert.disposition, first.disposition);
      if (first.investigation_id) sampled++; else skipped++;
    }
    assert.ok(sampled > 0 && skipped > 0);
    while (pipeline.processNext()) { /* drain local phases */ }
    for (const alert of pipeline.list("other")) {
      if (alert.investigation_id) {
        const job = pipeline.context("other", alert.investigation_id).jobs[0]!;
        assert.equal(job.result.matches.length, 0, "demo indicators must not leak into other tenant runs");
        assert.equal(store.get("investigations", "other", alert.investigation_id)!.determination, "unknown");
      }
    }
  } finally { db.close(); }
});
