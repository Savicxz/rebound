import { expect, test, Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const screenshots = path.resolve(
  __dirname,
  "../../../docs/demo-studio/screenshots",
);
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start local demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Demo Studio", exact: true }),
  ).toBeVisible();
  expect((await page.request.post("/api/v1/demo/reset")).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run demonstration", exact: true }),
  ).toBeEnabled();
});
async function run(page: Page, scenario: string) {
  await page
    .getByText("Choose a different story / three curated scenarios", {
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: scenario, exact: false }).click();
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm scenario", exact: true })
    .click();
}
async function screenshot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, name),
    fullPage: true,
    animations: "disabled",
  });
}
test("learning portal: onboarding, failure, recovery, print, JSON and replay", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const responses: { http_status: number | null }[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/v1/demo/workflow-check") && response.ok())
      responses.push(await response.json());
  });
  const action = await page
    .getByRole("button", { name: "Open course materials", exact: true })
    .boundingBox();
  expect(action!.y + action!.height).toBeLessThan(768);
  await page.screenshot({
    path: path.join(screenshots, "studio-initial-1366.png"),
  });
  await screenshot(page, "studio-ready.png");
  await run(page, "The learning portal goes offline");
  await expect(
    page.getByRole("heading", {
      name: "Waiting for health checks",
      exact: true,
    }),
  ).toBeVisible();
  await screenshot(page, "studio-active-detection.png");
  await expect
    .poll(() => responses.some((response) => response.http_status === null))
    .toBeTruthy();
  await expect(
    page.getByRole("heading", {
      name: "Portal restored. Recovery verified.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("student-receipt")).toContainText("HTTP 200");
  const dashboard = await (await page.request.get("/api/v1/dashboard")).json();
  const incident = await (
    await page.request.get(
      `/api/v1/incidents/${dashboard.demo_run.incident_id}`,
    )
  ).json();
  expect(incident.state).toBe("RESOLVED");
  expect(incident.resolved_at).toBeTruthy();
  expect(incident.latest_analysis.provider).toBe("demo_fallback");
  expect(incident.runbook_executions[0].runbook_id).toBe(
    "RESTART_DEMO_CHILD_SERVICE",
  );
  expect(
    incident.events.filter(
      (event: { event_type: string }) =>
        event.event_type === "VERIFICATION_PROBE_SUCCESS",
    ),
  ).toHaveLength(2);
  const runtime = await (await page.request.get("/api/v1/demo/runtime")).json();
  expect(runtime.child_pid).not.toBe(
    dashboard.demo_run.runtime_before.child_pid,
  );
  await expect(page.getByRole("region", { name: "Run outcome" })).toContainText(
    "not a live Gemini call",
  );
  await screenshot(page, "studio-crash-verified.png");
  await expect(page.getByRole("region", { name: "Run outcome" })).toContainText(
    "Try human-review scenario",
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download evidence JSON", exact: true })
    .click();
  const downloaded = await downloadPromise;
  const downloadPath = testInfo.outputPath("incident.json");
  await downloaded.saveAs(downloadPath);
  const exported = JSON.parse(await readFile(downloadPath, "utf8"));
  expect(exported.incident.id).toBe(incident.id);
  expect(exported.simulated).toBe(true);
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "Print incident summary", exact: true })
    .click();
  await expect(page.locator(".incident-print")).toContainText(incident.id);
  await expect(page.locator(".incident-print")).toContainText(
    "Deterministic demo fallback",
  );
  await expect(page.locator(".incident-print")).toContainText(
    "VERIFICATION_PROBE_SUCCESS",
  );
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("article", { name: "Printable incident summary" }),
  ).toBeVisible();
  await screenshot(page, "incident-print-summary.png");
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Replay this demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm replay", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/dashboard")).json()).demo_run
          .id,
    )
    .not.toBe(dashboard.demo_run.id);
  await expect(
    page.getByRole("heading", {
      name: "Portal restored. Recovery verified.",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("database contention: real HTTP 500, safe human review, dark mode and reset", async ({
  page,
}) => {
  await run(page, "Registration hits database contention");
  await expect(
    page.getByRole("heading", {
      name: "Automatic recovery safely blocked",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("student-receipt")).toContainText("HTTP 500");
  const dashboard = await (await page.request.get("/api/v1/dashboard")).json();
  expect(dashboard.active_incident.state).toBe("AWAITING_APPROVAL");
  expect(dashboard.active_incident.runbook_executions).toHaveLength(0);
  expect(dashboard.active_incident.auto_recovery_attempted).toBe(false);
  const runtime = await (await page.request.get("/api/v1/demo/runtime")).json();
  expect(runtime.child_pid).toBe(dashboard.demo_run.runtime_before.child_pid);
  await expect(
    page.locator('[aria-label="Before failure and after measurements"]'),
  ).toContainText("Current service");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await screenshot(page, "studio-human-review-dark.png");
  await page
    .getByRole("button", { name: "Try automatic recovery", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "The learning portal goes offline",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await page.request.get("/api/v1/dashboard")).json()).demo_run.id,
  ).toBe(dashboard.demo_run.id);

  await page
    .getByRole("button", { name: "Reset sandbox", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm reset", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Run ended by reset", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run demonstration", exact: true }),
  ).toBeEnabled();
});
test("attendance replay: actual queue drain, same PID, responsive and reduced motion", async ({
  page,
}) => {
  await run(page, "Attendance records stop syncing");
  await expect(
    page.getByRole("heading", {
      name: "Queue replayed. Recovery verified.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Run outcome" })).toContainText(
    "12 synthetic attendance records",
  );
  await expect(
    page.getByRole("region", { name: "Attendance sync", exact: true }),
  ).toContainText("0 records pending / 12 processed");
  const dashboard = await (await page.request.get("/api/v1/dashboard")).json();
  const incident = await (
    await page.request.get(
      `/api/v1/incidents/${dashboard.demo_run.incident_id}`,
    )
  ).json();
  const runtime = await (await page.request.get("/api/v1/demo/runtime")).json();
  expect(incident.runbook_executions[0].runbook_id).toBe(
    "REPLAY_DEMO_ATTENDANCE_QUEUE",
  );
  expect(runtime.child_pid).toBe(dashboard.demo_run.runtime_before.child_pid);
  expect(runtime.restart_count).toBe(
    dashboard.demo_run.runtime_before.restart_count,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "studio-attendance-mobile.png");
});
test("browser-to-backend disconnection: retain evidence, disable mutations, retry honestly", async ({
  page,
}) => {
  await page
    .getByText("Choose a different story / three curated scenarios", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "The learning portal goes offline",
      exact: false,
    })
    .click();
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.route("**/api/v1/**", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByText("Unable to refresh service data.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run demonstration", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open course materials", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", {
      name: "Waiting for fresh evidence",
      exact: true,
    }),
  ).toBeVisible();
  await screenshot(page, "studio-disconnected.png");
  await page.unroute("**/api/v1/**");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run demonstration", exact: true }),
  ).toBeEnabled();
});

test("connection lost during a live run never invents a result", async ({
  page,
}) => {
  await page
    .getByText("Choose a different story / three curated scenarios", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "The learning portal goes offline",
      exact: false,
    })
    .click();
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  const injected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/demo/failures") && response.ok(),
  );
  await page
    .getByRole("button", { name: "Confirm scenario", exact: true })
    .click();
  await injected;
  await page.route("**/api/v1/**", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Waiting for fresh evidence",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Portal restored. Recovery verified.",
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset sandbox", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/v1/**");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Portal restored. Recovery verified.",
      exact: true,
    }),
  ).toBeVisible();
  const dashboard = await (await page.request.get("/api/v1/dashboard")).json();
  const incident = await (
    await page.request.get(
      `/api/v1/incidents/${dashboard.demo_run.incident_id}`,
    )
  ).json();
  expect(incident.state).toBe("RESOLVED");
  expect(
    incident.events.some(
      (event: { event_type: string }) =>
        event.event_type === "INCIDENT_RESOLVED",
    ),
  ).toBe(true);
});
