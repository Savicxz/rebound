import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("repeatable live performance sample", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const baseline = process.env.REBOUND_BENCH_LABEL === "before";
  await page.addInitScript(() => {
    const measurements = {
      frames: [] as number[],
      longTasks: [] as number[],
      sse: [] as string[],
    };
    Object.assign(window, { reboundMeasurements: measurements });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        measurements.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    let previous = performance.now();
    const frame = (now: number) => {
      measurements.frames.push(now - previous);
      previous = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, config?: EventSourceInit) {
        super(url, config);
        this.addEventListener("message", (event) =>
          measurements.sse.push(JSON.parse(event.data).type),
        );
      }
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start local demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Demo Studio", exact: true }),
  ).toBeVisible();
  let dashboardRequests = 0,
    incidentRequests = 0,
    maximumConcurrent = 0;
  const active = new Set();
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/dashboard")) {
      dashboardRequests++;
      active.add(request);
      maximumConcurrent = Math.max(maximumConcurrent, active.size);
    }
    if (request.url().endsWith("/api/v1/incidents")) incidentRequests++;
  });
  page.on("requestfinished", (request) => active.delete(request));
  page.on("requestfailed", (request) => active.delete(request));
  const runs = [];
  const started = Date.now();
  for (let index = 0; index < 2; index++) {
    expect((await page.request.post("/api/v1/demo/reset")).ok()).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/v1/dashboard")).json())
            .services[0].status,
      )
      .toBe("HEALTHY");
    expect(
      (
        await page.request.post("/api/v1/demo/failures", {
          data: { type: "crash" },
        })
      ).ok(),
    ).toBeTruthy();
    const injectedRun = (
      await (await page.request.get("/api/v1/dashboard")).json()
    ).demo_run;
    await expect(
      page.getByText(injectedRun.id.slice(0, 8), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Portal restored. Recovery verified.",
        exact: true,
      }),
    ).toBeVisible();
    const visibleAt = Date.now();
    const data = await (await page.request.get("/api/v1/dashboard")).json();
    const incident = await (
      await page.request.get(`/api/v1/incidents/${data.demo_run.incident_id}`)
    ).json();
    const utc = (value: string) =>
      Date.parse(/Z|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
    const analysis = incident.events.find(
      (event: { event_type: string }) =>
        event.event_type === "ANALYSIS_COMPLETED",
    );
    const execution = incident.runbook_executions[0];
    expect(incident.state).toBe("RESOLVED");
    expect(incident.runbook_executions).toHaveLength(1);
    runs.push({
      injection_to_detection_ms:
        utc(incident.detected_at) - utc(data.demo_run.injected_at),
      detection_to_analysis_record_ms:
        utc(analysis.at) - utc(incident.detected_at),
      execution_start_to_verified_ms:
        utc(incident.resolved_at) - utc(execution.started_at),
      resolution_record_to_visible_ms: visibleAt - utc(incident.resolved_at),
    });
  }
  // Commit-return to a rendered recorded event, with the timeline already expanded.
  await page.getByText(/Incident event timeline \(/).click();
  const data = await (await page.request.get("/api/v1/dashboard")).json();
  expect(
    (
      await page.request.post(
        `/api/v1/incidents/${data.demo_run.incident_id}/acknowledge`,
      )
    ).ok(),
  ).toBeTruthy();
  const commitReturnedAt = Date.now();
  await expect(
    page.getByText("Incident acknowledged by operator admin.", { exact: true }),
  ).toBeVisible();
  const commitReturnToVisible = Date.now() - commitReturnedAt;
  const rendering = await page.evaluate(() => {
    const values = (
      window as unknown as {
        reboundMeasurements: {
          frames: number[];
          longTasks: number[];
          sse: string[];
        };
      }
    ).reboundMeasurements;
    const frames = [...values.frames].sort((a, b) => a - b);
    const options: Intl.DateTimeFormatOptions = {
      timeZone: "Asia/Kuala_Lumpur",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    };
    const date = new Date();
    let start = performance.now();
    for (let n = 0; n < 1000; n++) date.toLocaleTimeString("en-MY", options);
    const repeatedLocaleMs = performance.now() - start;
    const formatter = new Intl.DateTimeFormat("en-MY", options);
    start = performance.now();
    for (let n = 0; n < 1000; n++) formatter.format(date);
    return {
      frame_p95_ms: frames[Math.ceil(frames.length * 0.95) - 1],
      longest_frame_ms: frames.at(-1),
      long_tasks: values.longTasks.length,
      longest_task_ms: Math.max(0, ...values.longTasks),
      sse_types: values.sse.slice(-10),
      committed_sse_messages: values.sse.filter((type) => type === "COMMITTED")
        .length,
      repeated_locale_1000_ms: repeatedLocaleMs,
      reused_formatter_1000_ms: performance.now() - start,
    };
  });
  const result = {
    label: process.env.REBOUND_BENCH_LABEL || "after",
    elapsed_ms: Date.now() - started,
    dashboardRequests,
    incidentRequests,
    maximumConcurrent,
    commit_return_to_visible_ms: commitReturnToVisible,
    runs,
    rendering,
  };
  await writeFile(
    testInfo.outputPath("performance.json"),
    JSON.stringify(result, null, 2),
  );
  await testInfo.attach("performance", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  console.log(JSON.stringify(result));
  if (!baseline) {
    expect(rendering.committed_sse_messages).toBeGreaterThan(0);
    expect(maximumConcurrent).toBeLessThanOrEqual(1);
  }
});
