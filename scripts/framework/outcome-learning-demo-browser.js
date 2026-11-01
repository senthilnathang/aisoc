// Retained local demonstration. Creates uniquely scoped synthetic cases, approved
// Memory and a published Skill. No live providers, models or response execution.
async (page) => {
  const origin = "http://localhost:8080",
    tag = String(Date.now()),
    entity = "learning-demo-" + tag,
    name = "Review local training login " + tag;
  const ensure = (v, m) => {
    if (!v) throw new Error(m);
  };
  const checks = [];
  await page.goto(origin + "/investigations");
  const source = await page.evaluate(
    async ({ entity, tag }) => {
      const req = async (p, b) => {
        const r = await fetch("/api/v1" + p, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tenant-Id": "demo",
          },
          body: JSON.stringify(b),
        });
        const v = await r.json();
        if (!r.ok) throw new Error(JSON.stringify(v));
        return v;
      };
      const c = await req("/investigations", {
        title: "Reviewed training outcome " + tag,
        summary: "Synthetic local analyst-reviewed authentication fixture.",
        source: "local-json:learning-demo",
        category: "identity",
        severity: "medium",
        status: "resolved",
        determination: "benign",
        primary_entity: entity,
        insight_refs: [],
      });
      await req("/investigations/" + c.id + "/artifacts", {
        type: "entity",
        value: entity,
        label: "Verified synthetic identity",
      });
      return c;
    },
    { entity, tag },
  );
  await page.goto(origin + "/investigations/" + source.id + "?tab=review");
  await page
    .getByRole("button", { name: "Capture outcome learning", exact: true })
    .click();
  ensure(
    await page
      .getByRole("button", { name: "Approve learning", exact: true })
      .isDisabled(),
    "Approval enabled without evidence/consent",
  );
  const check = async (label) => {
    await page.getByRole("checkbox", { name: label }).focus();
    await page.keyboard.press("Space");
  };
  await check(/Verified synthetic identity/);
  await page.getByLabel("Skill name", { exact: false }).fill(name);
  await page
    .getByLabel("Reusable guidance", { exact: false })
    .fill(
      "Compare current authentication evidence with the training identity context. Escalate missing or contradictory MFA evidence. Require separate response approval.",
    );
  await check("Activate approved Memory context");
  await page
    .getByLabel("Approved context", { exact: false })
    .fill(
      "Synthetic training identity: this prior benign case is context only. Independently review future evidence and exceptions.",
    );
  await page
    .getByLabel("Approval rationale", { exact: false })
    .fill(
      "Reviewed synthetic case outcome and saved identity artifact; approved scoped reuse for this local demonstration.",
    );
  await check(
    "I reviewed the outcome, evidence and reuse scope and approve these outputs.",
  );
  await page.screenshot({
    path: "/opt/aisoc/output/playwright/outcome-learning-approval.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Approve learning", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open derived Skill", exact: true })
    .waitFor();
  ensure(
    await page
      .getByRole("button", { name: "Capture outcome learning", exact: true })
      .isDisabled(),
    "Same revision allowed fresh approval",
  );
  const receipt = await page.evaluate(async (id) => {
    const r = await fetch("/api/v1/investigations/" + id + "/learning", {
      headers: { "X-Tenant-Id": "demo" },
    });
    return (await r.json()).receipts[0];
  }, source.id);
  checks.push("explicit scoped approval and retained receipt");
  await page
    .getByRole("button", { name: "Open derived Skill", exact: true })
    .click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.getByText("Analyst-approved outcome", { exact: true }).waitFor();
  ensure(
    (await page.getByText("draft", { exact: true }).count()) > 0,
    "Not a draft",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("published", { exact: true }).waitFor();
  checks.push("existing draft and publish workflow with source provenance");
  const target = await page.evaluate(
    async ({ entity, tag }) => {
      const r = await fetch("/api/v1/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": "demo" },
        body: JSON.stringify({
          title: "Follow-up learning verification " + tag,
          summary: "New synthetic investigation; verdict must remain unknown.",
          source: "local-json:learning-demo",
          category: "identity",
          severity: "medium",
          status: "open",
          determination: "unknown",
          primary_entity: entity,
          insight_refs: [],
        }),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(v));
      return v;
    },
    { entity, tag },
  );
  ensure(target.determination === "unknown", "Learning changed determination");
  await page.goto(origin + "/investigations/" + target.id + "?tab=transcript");
  await page.getByText(name + " · v2", { exact: true }).waitFor();
  await page
    .getByText("Enterprise insight: " + entity, { exact: true })
    .waitFor();
  const application = page
    .getByText(name + " · v2", { exact: true })
    .locator("..")
    .locator("..");
  await application
    .getByRole("button", { name: "Helpful", exact: true })
    .click();
  await application.getByText("1 rating(s) saved", { exact: true }).waitFor();
  await page.screenshot({
    path: "/opt/aisoc/output/playwright/outcome-learning-applied.png",
    fullPage: true,
  });
  checks.push("existing matching, versioned snapshots and helpful feedback");
  await page.goto(origin + "/memory");
  await page.getByLabel("Search insights").fill(entity);
  await page.getByText("Analyst-approved outcome", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "1 investigations", exact: true })
    .click();
  await page.getByRole("button", { name: target.title, exact: true }).waitFor();
  checks.push("Memory use links to subsequent investigation");
  await page.keyboard.press("Escape");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + "/investigations/" + source.id + "?tab=review");
    await page
      .getByRole("button", { name: "Open derived Skill", exact: true })
      .waitFor();
    ensure(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      "Learning layout overflow " + width,
    );
    if (width === 390)
      await page.screenshot({
        path: "/opt/aisoc/output/playwright/outcome-learning-mobile.png",
        fullPage: true,
      });
    checks.push("responsive " + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/investigations/" + target.id + "?tab=transcript");
  return {
    passed: true,
    source: source.id,
    target: target.id,
    skill: receipt.skill_id,
    memory: receipt.insight_id,
    entity,
    checks,
  };
}
