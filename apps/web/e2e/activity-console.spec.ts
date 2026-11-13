import { expect, test, Page } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const captures = path.resolve(
  __dirname,
  "../../../docs/demo-studio/screenshots",
);
async function enter(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start local demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Recover stalled services",
      exact: true,
    }),
  ).toBeVisible();
}
async function prepare(page: Page) {
  await enter(page);
  expect((await page.request.post("/api/v1/demo/reset")).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run demonstration", exact: true }),
  ).toBeEnabled();
}
async function begin(page: Page) {
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm scenario", exact: true })
    .click();
}
async function capture(page: Page, name: string) {
  await mkdir(captures, { recursive: true });
  await page.screenshot({
    path: path.join(captures, name),
    fullPage: false,
    animations: "disabled",
  });
}

test.use({ video: { mode: "on", size: { width: 1366, height: 768 } } });

test.describe("live recorded console", () => {
  test("actual attendance activity and safe refusal, with recording", async ({
    page,
  }) => {
    test.setTimeout(150000);
    await prepare(page);
    await capture(page, "console-initial.png");
    await begin(page);
    const feed = page.getByRole("list", {
      name: "Recorded activity",
      exact: true,
    });
    await expect(
      feed.locator('[data-event-type="INCIDENT_OPENED"]'),
    ).toBeVisible();
    await capture(page, "console-failure.png");
    await expect(
      feed.locator('[data-event-type="POLICY_EVALUATED"]'),
    ).toBeVisible();
    await capture(page, "console-analysis-policy.png");
    await expect(
      feed.locator('[data-event-type="RECOVERY_ACTION_COMPLETED"]'),
    ).toBeVisible();
    await capture(page, "console-recovery.png");
    await expect(
      feed.getByRole("heading", {
        name: "Second verification check",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Observed attendance result"),
    ).not.toBeVisible();
    await capture(page, "console-verification.png");
    await expect(page.getByLabel("Observed attendance result")).toContainText(
      "Processed afterward12",
    );
    await expect(page.getByLabel("Observed attendance result")).toContainText(
      "Remaining0",
    );
    const counts = await page
      .getByLabel("Observed attendance result")
      .boundingBox();
    expect(counts!.y + counts!.height).toBeLessThanOrEqual(768);
    await capture(page, "console-success.png");
    await page.getByLabel("Change scenario").selectOption("degraded");
    await page
      .getByRole("button", { name: "Run selected scenario", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm replay", exact: true })
      .click();
    await expect(
      feed.getByRole("heading", {
        name: "Human investigation required",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      feed.locator(
        '[data-event-type="RECOVERY_STARTED"], [data-event-type="VERIFICATION_PROBE_SUCCESS"], [data-event-type="INCIDENT_RESOLVED"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Observed attendance result"),
    ).not.toBeVisible();
    await capture(page, "console-human-review.png");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(page, "console-mobile.png");
  });
});

test("completed incident, pacing, pause/resume, skip, replay, stale evidence and reduced motion", async ({
  page,
}) => {
  test.setTimeout(120000);
  await prepare(page);
  await begin(page);
  await expect(
    page.getByRole("heading", {
      name: "Queue replayed. Recovery verified.",
      exact: true,
    }),
  ).toBeVisible();
  const skip = page.getByRole("button", {
    name: "Skip to latest",
    exact: true,
  });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByLabel("Observed attendance result")).toBeVisible();
  const dashboard = await (await page.request.get("/api/v1/dashboard")).json();
  const incident = await (
    await page.request.get(
      `/api/v1/incidents/${dashboard.demo_run.incident_id}`,
    )
  ).json();
  // Derive an out-of-order duplicate delivery fixture from this actual completed run.
  await page.route(`**/api/v1/incidents/${incident.id}`, (route) =>
    route.fulfill({
      json: {
        ...incident,
        events: [...incident.events].reverse().concat(incident.events[0]),
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Start local demo", exact: true })
    .click();
  const entries = page.locator(".activity-feed .activity-entry");
  await expect(entries).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Pause presentation", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Observed attendance result")).toContainText(
    "Not observed",
  );
  expect(
    await entries.evaluateAll((elements) =>
      elements.map((element) => Number(element.getAttribute("data-sequence"))),
    ),
  ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  await page
    .getByRole("button", { name: "Replay recorded activity", exact: true })
    .click();
  await expect(entries).toHaveCount(0);
  await expect(page.getByLabel("Observed attendance result")).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Queue replayed. Recovery verified.",
      exact: true,
    }),
  ).toBeVisible();
  await page.clock.runFor(1699);
  await expect(entries).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(entries).toHaveCount(1);
  await page
    .getByRole("button", { name: "Pause presentation", exact: true })
    .click();
  await page.clock.runFor(5000);
  await expect(entries).toHaveCount(1);
  await page
    .getByRole("button", { name: "Resume presentation", exact: true })
    .click();
  await page.clock.runFor(1700);
  await expect(entries).toHaveCount(2);
  await page.route("**/api/v1/dashboard", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByText(
      "Fresh evidence is unavailable. Presentation paused; no outcome is inferred.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.clock.runFor(10000);
  await expect(entries).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Skip to latest", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/v1/dashboard");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByText(
      "Fresh evidence is unavailable. Presentation paused; no outcome is inferred.",
      { exact: true },
    ),
  ).not.toBeVisible();
  await page.clock.runFor(2000);
  await expect(entries).toHaveCount(2);
  await page
    .getByRole("button", { name: "Resume presentation", exact: true })
    .click();
  await page.clock.runFor(1700);
  await expect(entries).toHaveCount(3);
  await page
    .getByRole("button", { name: "Skip to latest", exact: true })
    .click();
  await expect(entries).toHaveCount(8);
  await expect(page.getByLabel("Observed attendance result")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Replay recorded activity", exact: true })
    .click();
  await expect(entries).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Pause presentation", exact: true }),
  ).toHaveCount(0);
  expect(
    await entries
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
});
