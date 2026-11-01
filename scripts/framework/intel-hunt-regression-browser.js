// Validation and UI failure tests. Replays only an existing local import;
// all promotion mutations are intercepted and never affect response execution.
async (page) => {
  const origin = "http://localhost:8080";
  await page.goto(origin + "/threat-intel");
  const fixture = await page.evaluate(async () => {
    const get = async (p) => {
      const r = await fetch("/api/v1" + p, {
        headers: { "X-Tenant-Id": "demo" },
      });
      if (!r.ok) throw new Error("Fixture read failed");
      return r.json();
    };
    const reports = await get(
      "/threat-intel/registry?search=Local%20suspicious-login%20indicators",
    );
    for (const report of reports.items) {
      const w = await get("/threat-intel-reports/" + report.id + "/workspace");
      if (
        !w.imports?.some(
          (x) =>
            x.external_id === "intel-login-001" && x.source === "local-demo",
        )
      )
        continue;
      for (const link of w.hunts) {
        if (!link.available) continue;
        const h = await get("/hunts/" + link.hunt_id + "/workspace");
        const p = h.promotions?.find(
          (p) => p.available && p.run_id === h.runs[0]?.id,
        );
        if (p)
          return {
            report: report.id,
            hunt: link.hunt_id,
            caseID: p.investigation_id,
          };
      }
    }
    throw new Error("Run intel-hunt-demo-browser.js first");
  });
  const { report, hunt, caseID } = fixture;
  const ensure = (x, m) => {
    if (!x) throw new Error(m);
  };
  const checks = [];
  let pending,
    finish,
    delay = false,
    promotions = 0,
    firstBody;
  const handler = async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/workspace") && p.includes("/hunts/")) {
      const r = await route.fetch();
      const w = await r.json();
      w.promotions = [];
      return route.fulfill({ json: w });
    }
    if (p.endsWith("/promote")) {
      const b = route.request().postDataJSON();
      promotions++;
      if (promotions === 1) {
        firstBody = JSON.stringify(b);
        return route.fulfill({
          status: 503,
          json: {
            error: { message: "Temporary fixture failure; retry safely." },
          },
        });
      }
      ensure(
        JSON.stringify(b) === firstBody,
        "Promotion retry changed identity",
      );
      return route.fulfill({
        json: { investigation_id: caseID, available: true },
      });
    }
    if (p === "/api/v1/threat-intel/import" && delay) {
      pending = true;
      await new Promise((r) => (finish = r));
      return route.fulfill({ json: { report_id: report, replayed: true } });
    }
    return route.continue();
  };
  await page.route("**/api/v1/**", handler);
  try {
    await page.goto(origin + "/threat-intel");
    await page
      .getByRole("button", { name: "Import JSON", exact: true })
      .click();
    const editor = page.getByLabel("Intelligence JSON", { exact: true });
    const original = await editor.inputValue();
    await editor.fill("{broken");
    await page
      .getByRole("button", { name: "Validate JSON", exact: true })
      .click();
    ensure(
      await page
        .getByRole("button", { name: "Import validated JSON", exact: true })
        .isDisabled(),
      "Invalid JSON enabled import",
    );
    let invalid = JSON.parse(original);
    invalid.indicators = [
      { type: "url", value: "https://user:secret@example.test" },
    ];
    await editor.fill(JSON.stringify(invalid));
    await page
      .getByRole("button", { name: "Validate JSON", exact: true })
      .click();
    await page
      .getByText(/Indicator 1: unsupported type or invalid value/)
      .waitFor();
    checks.push("invalid JSON and credential URL rejected");
    await editor.fill(original);
    await page
      .getByRole("button", { name: "Validate JSON", exact: true })
      .click();
    await page.getByText("Validation passed", { exact: true }).waitFor();
    await editor.fill(original + " ");
    ensure(
      await page
        .getByRole("button", { name: "Import validated JSON", exact: true })
        .isDisabled(),
      "Edited preview remained valid",
    );
    checks.push("editing clears validation");
    await page
      .getByRole("button", { name: "Validate JSON", exact: true })
      .click();
    await page.getByText("Validation passed", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Import validated JSON", exact: true })
      .click();
    await page.getByText("JSON import provenance", { exact: true }).waitFor();
    ensure(
      page.url().endsWith(report),
      "Identical import created a second report",
    );
    checks.push("real API replay returns same report");
    await page.goto(origin + "/threat-intel");
    await page
      .getByRole("button", { name: "Import JSON", exact: true })
      .click();
    let conflict = JSON.parse(original);
    conflict.title = "Changed content";
    await page
      .getByLabel("Intelligence JSON", { exact: true })
      .fill(JSON.stringify(conflict));
    await page
      .getByRole("button", { name: "Validate JSON", exact: true })
      .click();
    await page.getByText("Validation passed", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Import validated JSON", exact: true })
      .click();
    await page.getByText(/already has different content/).waitFor();
    checks.push("real API identity conflict");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Import JSON", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Validate JSON", exact: true })
      .click();
    await page.getByText("Validation passed", { exact: true }).waitFor();
    delay = true;
    await page
      .getByRole("button", { name: "Import validated JSON", exact: true })
      .click();
    ensure(pending, "Import request not captured");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    finish();
    await page
      .getByRole("button", { name: "Import JSON", exact: true })
      .waitFor();
    ensure(
      page.url() === origin + "/threat-intel",
      "Closed modal navigated after completion",
    );
    checks.push("closed import ignores late response");
    await page.goto(origin + "/hunt/threat-hunting/" + hunt);
    await page
      .getByRole("button", { name: "Promote to investigation", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Promotion review comment")
      .fill("Reviewed this saved fixture evidence for a safe retry.");
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
      .getByText("Temporary fixture failure; retry safely.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Confirm promotion", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Open promoted investigation →",
        exact: true,
      })
      .first()
      .waitFor();
    checks.push(
      "promotion failure preserves explicit consent and retry identity",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/threat-intel");
    await page
      .getByRole("button", { name: "Import JSON", exact: true })
      .click();
    ensure(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
      "Mobile import overflow",
    );
    await page.screenshot({
      path: "/opt/aisoc/output/playwright/intel-import-mobile.png",
      fullPage: true,
    });
    checks.push("mobile import layout");
    return { passed: true, checks };
  } finally {
    finish?.();
    await page.unroute("**/api/v1/**", handler);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + "/investigations/" + caseID);
  }
};
