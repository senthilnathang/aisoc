// Writes a clearly labeled synthetic source case and retained local demo flow.
async (page) => {
  const origin = "http://localhost:8080";
  const ensure = (x, m) => {
    if (!x) throw new Error(m);
  };
  await page.goto(origin + "/threat-intel");
  const seed = await page.evaluate(async () => {
    const request = async (path, body) => {
      const r = await fetch("/api/v1" + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": "demo" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(v));
      return v;
    };
    const list = await request(
      "/investigations?search=Intel%20hunt%20synthetic%20observation&limit=50",
    );
    return (
      list.items?.find((x) => x.source === "local-json:intel-hunt-demo") ||
      (await request("/investigations", {
        title: "Intel hunt synthetic observation",
        summary:
          "Synthetic local fixture: test account contacted example.test from 203.0.113.77. This is demonstration evidence, not a real security event.",
        source: "local-json:intel-hunt-demo",
        category: "identity",
        severity: "medium",
        status: "open",
        determination: "unknown",
        primary_entity: "demo-intel-user",
        insight_refs: [],
      }))
    );
  });
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page
    .getByLabel("JSON file", { exact: true })
    .setInputFiles("/opt/aisoc/examples/threat-intel/local-login.json");
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await page.getByText("Validation passed", { exact: true }).waitFor();
  await page
    .getByText("3 submitted · 2 unique · 1 duplicates removed", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "/opt/aisoc/output/playwright/intel-import-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Import validated JSON", exact: true })
    .click();
  await page.getByText("JSON import provenance", { exact: true }).waitFor();
  const reportURL = page.url();
  await page.getByRole("button", { name: "Indicators", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "example.test" });
  await row
    .getByRole("button", { name: "Create local hunt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run local search", exact: true })
    .waitFor();
  const huntURL = page.url();
  await page
    .getByRole("button", { name: "Run local search", exact: true })
    .click();
  const promote = page
    .getByRole("button", { name: "Promote to investigation", exact: true })
    .first();
  await promote.waitFor();
  await promote.click();
  ensure(
    await page
      .getByRole("button", { name: "Confirm promotion", exact: true })
      .isDisabled(),
    "Confirmation bypass",
  );
  await page
    .getByLabel("Promotion review comment")
    .fill(
      "Reviewed the synthetic saved finding and source; investigate this local demo match.",
    );
  await page
    .getByRole("checkbox", {
      name: "I reviewed this saved finding and want to investigate it.",
    })
    .focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("button", { name: "Confirm promotion", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open promoted investigation →", exact: true })
    .first()
    .click();
  await page.getByText("Hunt evidence provenance", { exact: true }).waitFor();
  const caseURL = page.url();
  ensure(
    (await page
      .getByRole("button", { name: "Source intelligence report", exact: true })
      .count()) === 1,
    "Missing TI source",
  );
  await page.screenshot({
    path: "/opt/aisoc/output/playwright/intel-promoted-investigation.png",
    fullPage: true,
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    ensure(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      "Case overflow " + width,
    );
  }
  await page.goto(huntURL);
  await page
    .getByRole("button", { name: "Open promoted investigation →", exact: true })
    .first()
    .waitFor();
  await page.screenshot({
    path: "/opt/aisoc/output/playwright/intel-hunt-mobile.png",
    fullPage: true,
  });
  ensure(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
    "Hunt mobile overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(caseURL);
  return {
    passed: true,
    seed: seed.id,
    reportURL,
    huntURL,
    caseURL,
    checks: [
      "JSON file import",
      "canonical dedup preview",
      "stored local search",
      "explicit promotion consent",
      "persisted provenance and promotion link",
      "1440/390 responsive",
    ],
  };
};
