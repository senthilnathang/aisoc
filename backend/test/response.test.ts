import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";

const plan = {
  kind: "runbook",
  title: "Recover identity",
  description: "Contain and recover",
  domain: "Identity",
  trigger: "Confirmed compromise",
  steps: [
    {
      title: "Review evidence",
      instructions: "Verify scope",
      approval_required: false,
    },
    {
      title: "Revoke sessions",
      instructions: "Confirm target",
      approval_required: true,
    },
  ],
};

test("response library persists versions, duplicate and archive across restarts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aisoc-response-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = {
    databasePath: join(dir, "test.sqlite"),
    workerEnabled: false,
  };
  let app = await buildApp(config);
  const create = await app.inject({
    method: "POST",
    url: "/api/v1/response-plans",
    payload: plan,
  });
  assert.equal(create.statusCode, 201);
  const original = create.json();
  const path = "/api/v1/response-plans/" + original.id;
  const updated = await app.inject({
    method: "PATCH",
    url: path,
    payload: { ...plan, title: "Updated procedure", expected_version: 1 },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().version, 2);
  const stale = await app.inject({
    method: "PATCH",
    url: path,
    payload: { ...plan, expected_version: 1 },
  });
  assert.equal(stale.statusCode, 409);
  const duplicate = await app.inject({
    method: "POST",
    url: path + "/duplicate",
  });
  assert.equal(duplicate.statusCode, 201);
  assert.equal(duplicate.json().version, 1);
  assert.notEqual(duplicate.json().id, original.id);
  assert.equal(duplicate.json().title, "Updated procedure (copy)");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: path + "/state",
        payload: { expected_version: 2, state: "archived" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: path,
        payload: { ...plan, expected_version: 3 },
      })
    ).statusCode,
    409,
  );
  const assignment = (
    await app.inject({
      method: "POST",
      url: "/api/v1/investigations/INV-4814/runbooks",
      payload: { plan_id: duplicate.json().id, expected_version: 1 },
    })
  ).json();
  assert.ok(assignment.id);
  await app.inject({
    method: "PATCH",
    url: "/api/v1/investigations/INV-4814/runbooks/" + assignment.id,
    payload: {
      expected_version: 1,
      step_index: 0,
      completed: true,
      note: "Reviewed evidence",
      approval_confirmed: false,
    },
  });
  await app.close();
  app = await buildApp(config);
  const persisted = (
    await app.inject({
      method: "GET",
      url: "/api/v1/investigations/INV-4814/runbooks",
    })
  ).json().items[0];
  assert.equal(persisted.steps[0].completed, true);
  assert.equal(persisted.steps[0].note, "Reviewed evidence");
  assert.equal(persisted.history.length, 2);
  t.after(() => app.close());
  assert.equal(
    (await app.inject({ method: "GET", url: path })).json().state,
    "archived",
  );
  const history = (
    await app.inject({ method: "GET", url: path + "/history" })
  ).json().items;
  assert.deepEqual(
    history.map((item: { action: string }) => item.action),
    ["archived", "updated", "created"],
  );
  assert.equal(history[2].snapshot.title, plan.title);
  assert.equal(history[0].actor, "local-development");
  const restore = await app.inject({
    method: "POST",
    url: path + "/state",
    payload: { expected_version: 3, state: "active" },
  });
  assert.equal(restore.json().version, 4);
  assert.equal(restore.json().state, "active");
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/response-plans" })).json()
      .items.length,
    8,
  );
});

test("case runbooks pin versions, enforce approval, persist notes and audit reopening", async (t) => {
  const app = await buildApp({
    databasePath: ":memory:",
    workerEnabled: false,
  });
  t.after(() => app.close());
  const created = (
    await app.inject({
      method: "POST",
      url: "/api/v1/response-plans",
      payload: plan,
    })
  ).json();
  const path = "/api/v1/investigations/INV-4814/runbooks";
  const attached = await app.inject({
    method: "POST",
    url: path,
    payload: { plan_id: created.id, expected_version: 1 },
  });
  assert.equal(attached.statusCode, 201);
  const assignment = attached.json();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: path,
        payload: { plan_id: created.id, expected_version: 1 },
      })
    ).statusCode,
    409,
  );
  await app.inject({
    method: "PATCH",
    url: "/api/v1/response-plans/" + created.id,
    payload: { ...plan, steps: [plan.steps[0]], expected_version: 1 },
  });
  const initial = (await app.inject({ method: "GET", url: path })).json()
    .items[0];
  assert.equal(initial.snapshot.version, 1);
  assert.equal(initial.snapshot.steps.length, 2);
  const patch = {
    expected_version: 1,
    step_index: 1,
    completed: true,
    note: "Approved by analyst; sessions reviewed",
    approval_confirmed: false,
  };
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: path + "/" + assignment.id,
        payload: patch,
      })
    ).statusCode,
    400,
  );
  const complete = await app.inject({
    method: "PATCH",
    url: path + "/" + assignment.id,
    payload: { ...patch, approval_confirmed: true },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().steps[1].completed, true);
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: path + "/" + assignment.id,
        payload: { ...patch, approval_confirmed: true },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: path + "/" + assignment.id,
        payload: { ...patch, expected_version: 2, step_index: 10 },
      })
    ).statusCode,
    400,
  );
  const reopen = await app.inject({
    method: "PATCH",
    url: path + "/" + assignment.id,
    payload: {
      ...patch,
      expected_version: 2,
      completed: false,
      note: "Rechecking target",
    },
  });
  assert.equal(reopen.json().steps[1].completed, false);
  const result = (await app.inject({ method: "GET", url: path })).json()
    .items[0];
  assert.equal(result.history.length, 3);
  assert.equal(result.history[1].approval_confirmed, true);
  assert.equal(result.history[0].note, "Rechecking target");
  const audit = (
    await app.inject({
      method: "GET",
      url: "/api/v1/investigations/INV-4814/history",
    })
  ).json().items;
  assert.ok(
    audit.some(
      (event: { action: string }) => event.action === "runbook_step_completed",
    ),
  );
});

test("response plans and case assignments reject cross-tenant access", async (t) => {
  const app = await buildApp({
    databasePath: ":memory:",
    workerEnabled: false,
  });
  t.after(() => app.close());
  const created = (
    await app.inject({
      method: "POST",
      url: "/api/v1/response-plans",
      payload: plan,
    })
  ).json();
  const headers = { "x-tenant-id": "other-tenant" };
  const path = "/api/v1/response-plans/" + created.id;
  assert.deepEqual(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/response-plans",
        headers,
      })
    ).json().items,
    [],
  );
  for (const suffix of ["", "/history"])
    assert.equal(
      (await app.inject({ method: "GET", url: path + suffix, headers }))
        .statusCode,
      404,
    );
  assert.equal(
    (await app.inject({ method: "POST", url: path + "/duplicate", headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: path,
        headers,
        payload: { ...plan, expected_version: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: path + "/state",
        headers,
        payload: { state: "archived", expected_version: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/investigations/INV-4814/runbooks",
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/investigations/INV-4814/runbooks",
        headers,
        payload: { plan_id: created.id, expected_version: 1 },
      })
    ).statusCode,
    404,
  );
  const otherCase = (
    await app.inject({
      method: "POST",
      url: "/api/v1/investigations",
      headers,
      payload: { title: "Other case", source: "Test", severity: "high" },
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/investigations/" + otherCase.id + "/runbooks",
        headers,
        payload: { plan_id: created.id, expected_version: 1 },
      })
    ).statusCode,
    404,
  );
  const attached = (
    await app.inject({
      method: "POST",
      url: "/api/v1/investigations/INV-4814/runbooks",
      payload: { plan_id: created.id, expected_version: 1 },
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url:
          "/api/v1/investigations/" + otherCase.id + "/runbooks/" + attached.id,
        headers,
        payload: {
          expected_version: 1,
          step_index: 0,
          completed: true,
          note: "",
          approval_confirmed: false,
        },
      })
    ).statusCode,
    404,
  );
});

test("plan validation rejects invalid definitions and unsuitable attachments", async (t) => {
  const app = await buildApp({
    databasePath: ":memory:",
    workerEnabled: false,
  });
  t.after(() => app.close());
  for (const payload of [
    { ...plan, title: " " },
    { ...plan, steps: [] },
    { ...plan, steps: Array(51).fill(plan.steps[0]) },
    { ...plan, steps: [{ ...plan.steps[0], approval_required: "yes" }] },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/response-plans",
          payload,
        })
      ).statusCode,
      400,
    );
  }
  // Fastify strips unknown body properties; tenant identity must still come from auth.
  const spoofed = await app.inject({
    method: "POST",
    url: "/api/v1/response-plans",
    payload: { ...plan, tenant_id: "other" },
  });
  assert.equal(spoofed.statusCode, 201);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/response-plans/" + spoofed.json().id,
        headers: { "x-tenant-id": "other" },
      })
    ).statusCode,
    404,
  );
  const workflow = (
    await app.inject({
      method: "POST",
      url: "/api/v1/response-plans",
      payload: { ...plan, kind: "workflow" },
    })
  ).json();
  const url = "/api/v1/investigations/INV-4814/runbooks";
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        payload: { plan_id: workflow.id, expected_version: 1 },
      })
    ).statusCode,
    400,
  );
  const runbook = (
    await app.inject({
      method: "POST",
      url: "/api/v1/response-plans",
      payload: plan,
    })
  ).json();
  await app.inject({
    method: "POST",
    url: "/api/v1/response-plans/" + runbook.id + "/state",
    payload: { state: "archived", expected_version: 1 },
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        payload: { plan_id: runbook.id, expected_version: 2 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        payload: { plan_id: runbook.id, expected_version: 1 },
      })
    ).statusCode,
    409,
  );
});
