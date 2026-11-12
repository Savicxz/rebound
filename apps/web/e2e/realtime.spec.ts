import { expect, test } from "@playwright/test";

test("event bursts coalesce, duplicate revisions are ignored, navigation aborts pending fetch", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class ControlledStream {
      onopen: (() => void) | null = null;
      onmessage:
        | ((event: { data: string; lastEventId: string }) => void)
        | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        Object.assign(window, { testStream: this });
        queueMicrotask(() => this.onopen?.());
      }
      close() {}
    }
    Object.assign(window, { EventSource: ControlledStream });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start local demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Demo Studio", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh data", exact: true }),
  ).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/v1/dashboard", async (route) => {
    requests++;
    if (requests === 1) await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(() => {
    const stream = (
      window as unknown as {
        testStream: {
          onmessage: (event: { data: string; lastEventId: string }) => void;
        };
      }
    ).testStream;
    for (let index = 1; index <= 20; index++)
      stream.onmessage({
        data: JSON.stringify({ type: "COMMITTED" }),
        lastEventId: String(index),
      });
  });
  // Deliberate network hold: every refresh trigger must share the outstanding request.
  await page.waitForTimeout(300);
  expect(requests).toBe(1);
  release();
  await expect.poll(() => requests).toBe(2);
  await expect(
    page.getByRole("button", { name: "Refresh data", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const stream = (
      window as unknown as {
        testStream: {
          onmessage: (event: { data: string; lastEventId: string }) => void;
        };
      }
    ).testStream;
    for (let index = 0; index < 20; index++)
      stream.onmessage({
        data: JSON.stringify({ type: "COMMITTED" }),
        lastEventId: "20",
      });
  });
  await page.waitForTimeout(300);
  expect(requests).toBe(2);
  await page.unroute("**/api/v1/dashboard");
  let stop!: () => void;
  const held = new Promise<void>((resolve) => {
    stop = resolve;
  });
  await page.route("**/api/v1/dashboard", async (route) => {
    await held;
    await route.abort().catch(() => {});
  });
  const requested = page.waitForRequest("**/api/v1/dashboard");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await requested;
  const cancelled = page
    .context()
    .waitForEvent("requestfailed", (request) =>
      request.url().endsWith("/api/v1/dashboard"),
    );
  await page.goto("about:blank");
  await cancelled;
  stop();
});

test("incident history loads summaries and fetches full evidence only on selection", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start local demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Demo Studio", exact: true }),
  ).toBeVisible();
  expect((await page.request.post("/api/v1/demo/reset")).ok()).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/dashboard")).json()).services[0]
          .status,
    )
    .toBe("HEALTHY");
  expect(
    (
      await page.request.post("/api/v1/demo/failures", {
        data: { type: "degraded" },
      })
    ).ok(),
  ).toBeTruthy();
  await expect(
    page.getByRole("heading", {
      name: "Unsafe restart prevented.",
      exact: true,
    }),
  ).toBeVisible();
  const summaryResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/incidents?include_evidence=false"),
  );
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  const records = await (await summaryResponse).json();
  expect(records.length).toBeGreaterThan(0);
  expect(records[0].events).toEqual([]);
  const detailResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/v1/incidents/${records[0].id}`),
  );
  await page
    .getByRole("button", {
      name: `View details for ${records[0].title}`,
      exact: true,
    })
    .first()
    .click();
  const detail = await (await detailResponse).json();
  expect(
    detail.events.some(
      (event: { event_type: string }) =>
        event.event_type === "HUMAN_REVIEW_REQUIRED",
    ),
  ).toBe(true);
  await expect(page.getByRole("dialog")).toContainText("demo_fallback");
  await expect(page.getByRole("dialog")).toContainText(
    "No automated recovery is authorized",
  );
});
