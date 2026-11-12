// Run with: node scripts/check-overview.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const filename = path.resolve(__dirname, "../src/components/OverviewView.tsx");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;
const component = new Module(filename, module);
component.filename = filename;
component.paths = module.paths;
// These checks cover content and states; icon rendering belongs to the Next build.
const originalRequire = component.require.bind(component);
const chartFilename = path.resolve(
  __dirname,
  "../src/components/MonitoringCharts.tsx",
);
const charts = new Module(chartFilename, module);
charts.filename = chartFilename;
charts.paths = module.paths;
charts._compile(
  ts.transpileModule(fs.readFileSync(chartFilename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText,
  chartFilename,
);
const additionalViews = new Map();
function loadView(name) {
  if (additionalViews.has(name)) return additionalViews.get(name);
  const base = path.resolve(__dirname, "../src/components", name);
  const source = fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`;
  const loaded = new Module(source, module);
  loaded.filename = source;
  loaded.paths = module.paths;
  loaded.require = (request) =>
    request.startsWith(".")
      ? loadView(path.resolve(path.dirname(source), request))
      : component.require(request);
  loaded._compile(
    ts.transpileModule(fs.readFileSync(source, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    source,
  );
  additionalViews.set(name, loaded.exports);
  return loaded.exports;
}
component.require = (name) =>
  name === "lucide-react"
    ? new Proxy(
        {},
        {
          get: () => () => React.createElement("svg", { "aria-hidden": true }),
        },
      )
    : name === "./MonitoringCharts"
      ? charts.exports
      : name.startsWith("./") || name.startsWith("../lib/")
        ? loadView(name.startsWith("./") ? name.slice(2) : name)
        : originalRequire(name);
component._compile(compiled, filename);
const View = component.exports.default;
const props = {
  currentUser: { username: "operator", role: "OPERATOR" },
  onRefresh() {},
};
const render = (extra) =>
  renderToStaticMarkup(React.createElement(View, { ...props, ...extra }));
const data = {
  metrics: {
    monitored_services_count: 1,
    healthy_services_count: 0,
    open_incidents_count: 1,
    total_recovered_count: 0,
  },
  services: [],
  recent_events: [],
  recent_notifications: [],
  active_incident: {
    id: "incident-1",
    title: "Learning service outage",
    state: "AWAITING_APPROVAL",
    detected_at: "2026-11-09T01:00:00Z",
    events: [],
    runbook_executions: [],
    latest_analysis: {
      provider: "demo_fallback",
      confidence: "low",
      requires_human_review: true,
      summary: "HTTP 500 observed",
      suspected_cause: "Unknown application fault",
      reasoning_summary: "Administrator investigation required",
      evidence_event_ids: ["probe-1"],
    },
  },
};
assert.match(render({ data: null }), /Loading service health/);
const failure = render({ data: null, loadError: "API unavailable" });
assert.match(failure, /Use Refresh data to retry/);
assert.doesNotMatch(failure, /animate-pulse/);
const pending = render({ data });
assert.ok(
  pending.indexOf("Learning service outage") <
    pending.indexOf("Monitored Services"),
);
assert.match(pending, /Paused for administrator review/);
assert.match(pending, /Confidence: low/);
assert.match(pending, /Human review required/);
assert.match(pending, /probe-1/);
assert.equal((pending.match(/Not recorded yet/g) || []).length, 3);
data.active_incident.events = [
  { event_type: "ANALYSIS_COMPLETED", at: "2026-11-09T01:01:00Z" },
];
assert.equal((render({ data }).match(/Not recorded yet/g) || []).length, 2);
data.active_incident = null;
assert.match(render({ data }), /No active incidents/);
assert.doesNotMatch(render({ data }), /All Systems Operational/);
data.services = [
  {
    id: "service-a",
    display_name: "Learning portal",
    status: "HEALTHY",
    consecutive_failures: 0,
  },
  {
    id: "service-b",
    display_name: "Assessment demo",
    status: "DEGRADED",
    consecutive_failures: 2,
  },
];
data.recent_events = Array.from({ length: 7 }, (_, index) => ({
  id: `event-${index}`,
  public_message: `Recorded activity ${index}`,
  at: `2026-11-09T01:0${index}:00Z`,
  event_type: "PROBE_FAILED",
  actor_type: "SYSTEM",
}));
const compact = render({ data });
assert.match(compact, /Learning portal/);
assert.match(compact, /Assessment demo/);
assert.match(compact, /Recorded activity 6/);
assert.doesNotMatch(compact, /Recorded activity 0/);
assert.equal((compact.match(/Recorded activity/g) || []).length, 5);
assert.doesNotMatch(compact, /Simulate Outage/);
console.log(
  "Overview checks passed: loading, errors, incident priority, evidence, review and recorded progress.",
);

const demoFilename = path.resolve(
  __dirname,
  "../src/components/DemoControlsView.tsx",
);
const demo = new Module(demoFilename, module);
demo.filename = demoFilename;
demo.paths = module.paths;
demo.require = component.require;
demo._compile(
  ts.transpileModule(fs.readFileSync(demoFilename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText,
  demoFilename,
);
const renderDemo = (data) =>
  renderToStaticMarkup(
    React.createElement(demo.exports.default, {
      data,
      currentUser: {
        username: "operator",
        role: "OPERATOR",
        token: "test-token",
      },
    }),
  );
assert.match(renderDemo(null), /Waiting for service data/);
assert.doesNotMatch(renderDemo(null), /Active: Stage 1/);
const demoData = { services: [{ status: "DOWN" }], active_incident: null };
assert.match(renderDemo(demoData), /No timed progress simulation/);
assert.match(
  renderDemo(demoData),
  /waiting for the monitor to detect the fault/i,
);
demoData.active_incident = {
  state: "ESCALATED",
  id: "demo-1",
  events: [],
  runbook_executions: [],
};
assert.match(renderDemo(demoData), /Blocked for human review/);
assert.match(renderDemo(demoData), /Human review required/);
assert.match(renderDemo(demoData), /Demo Studio/);
assert.match(renderDemo(demoData), /Download evidence JSON/);
const newRun = renderDemo({
  ...demoData,
  demo_run: {
    id: "new-run",
    scenario_id: "wifi_mesh",
    service_id: "service-a",
    injected_at: new Date().toISOString(),
    incident_id: null,
    baseline: { http_status: 200, latency_ms: 3.2 },
    runtime_before: { child_pid: 123 },
    failure_threshold: 3,
    check_interval_seconds: 5,
  },
});
assert.match(newRun, /Waiting for health checks/);
assert.doesNotMatch(newRun, /demo-1/);
assert.match(newRun, /0 of 3 failed checks recorded/);
assert.match(
  renderDemo(demoData),
  /No real school infrastructure, student records/,
);
console.log(
  "Demo checks passed: loading, fault detection, escalation and scenario instructions.",
);

const navFilename = path.resolve(__dirname, "../src/components/Navbar.tsx");
const nav = new Module(navFilename, module);
nav.filename = navFilename;
nav.paths = module.paths;
nav.require = component.require;
nav._compile(
  ts.transpileModule(fs.readFileSync(navFilename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText,
  navFilename,
);
const navigation = renderToStaticMarkup(
  React.createElement(nav.exports.default, {
    currentTab: "incidents",
    currentUser: { username: "operator", role: "OPERATOR" },
    sseConnected: false,
  }),
);
assert.match(navigation, /aria-label="Main navigation"/);
assert.equal((navigation.match(/aria-current="page"/g) || []).length, 1);
assert.match(navigation, /Polling \/ reconnecting/);
assert.match(navigation, /Sign out or switch account/);
assert.match(navigation, /Not connected to live systems/);
console.log(
  "Navigation checks passed: current page, connection state, role switch and sandbox disclosure.",
);

const checks = [
  {
    id: "1",
    service_id: "a",
    observed_at: "2026-11-10T01:00:00Z",
    success: true,
    latency_ms: 10,
  },
  {
    id: "2",
    service_id: "a",
    observed_at: "2026-11-10T01:00:05Z",
    success: false,
    latency_ms: 2000,
  },
  {
    id: "3",
    service_id: "a",
    observed_at: "2026-11-10T01:00:10Z",
    success: true,
    latency_ms: 20,
  },
];
const summary = charts.exports.summarizeChecks(checks);
assert.equal(summary.average, 15);
assert.equal(summary.p95, 20);
assert.equal(summary.failed, 1);
assert.equal(charts.exports.summarizeChecks([]).successRate, null);
assert.equal(charts.exports.summarizeChecks([checks[1]]).average, null);
const chartMarkup = renderToStaticMarkup(
  React.createElement(charts.exports.default, {
    observations: checks,
    services: [{ id: "a", display_name: "Learning portal" }],
  }),
);
assert.match(chartMarkup, /66.7%/);
assert.match(chartMarkup, /15.0 ms/);
assert.match(chartMarkup, /not time-based uptime/);
assert.match(chartMarkup, /Inspect recorded checks/);
const emptyChart = renderToStaticMarkup(
  React.createElement(charts.exports.default, {
    observations: checks,
    services: [{ id: "other", display_name: "Other service" }],
  }),
);
assert.match(emptyChart, /No recorded checks/);
assert.doesNotMatch(emptyChart, /66.7%/);
console.log(
  "Chart checks passed: real sample totals, failed-check exclusion, latency statistics, service isolation and empty states.",
);

const auditView = loadView("AuditView");
assert.equal(auditView.formatPayload("bad json"), "bad json");
assert.equal(auditView.formatPayload('{"ok":true}'), '{\n  "ok": true\n}');
const longMessage = "Full recorded evidence ".repeat(50);
const auditMarkup = renderToStaticMarkup(
  React.createElement(auditView.default, {
    events: [
      {
        id: "audit-1",
        incident_id: "incident-1",
        sequence: 4,
        at: "2026-11-11T03:30:14Z",
        actor_type: "SYSTEM",
        actor_id: "policy_engine",
        event_type: "HUMAN_REVIEW_REQUIRED",
        public_message: longMessage,
      },
    ],
  }),
);
assert.ok(auditMarkup.includes(longMessage));
assert.match(auditMarkup, /Inspect event HUMAN_REVIEW_REQUIRED/);
assert.doesNotMatch(auditMarkup, /truncate/);
const evidence = loadView("DemoEvidence");
assert.ok(evidence.evidenceSteps(null).every((step) => !step.at));
const pausedSteps = evidence.evidenceSteps(demoData.active_incident);
assert.match(
  pausedSteps.find((step) => step.title === "Recovery").detail,
  /Blocked/,
);
assert.equal(
  pausedSteps.find((step) => step.title === "Verification").at,
  undefined,
);
const closedSteps = evidence.evidenceSteps({
  ...demoData.active_incident,
  state: "CLOSED",
});
assert.match(
  closedSteps.find((step) => step.title === "Verification").detail,
  /not verified/,
);
console.log(
  "Audit and evidence checks passed: full messages, malformed payloads, missing events, review blocks and unverified closure.",
);

const themeCss = fs.readFileSync(
  path.resolve(__dirname, "../src/app/globals.css"),
  "utf8",
);
const lightPalette = themeCss.match(/:root\s*\{([^}]+)\}/)[1];
const darkPalette = themeCss.match(
  /:root\[data-theme="dark"\]\s*\{([^}]+)\}/,
)[1];
function rgbVariable(block, name) {
  return block
    .match(new RegExp(`--${name}:\\s*([\\d ]+);`))[1]
    .trim()
    .split(/\s+/)
    .map(Number);
}
function luminance(rgb) {
  const channels = rgb.map((value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
for (const palette of [lightPalette, darkPalette]) {
  const background = luminance(rgbVariable(palette, "surface-bg"));
  for (const shade of [500, 700, 900]) {
    const foreground = luminance(rgbVariable(palette, `neutral-${shade}`));
    assert.ok(
      (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05) >=
        4.5,
      `Insufficient text contrast for shade ${shade}`,
    );
  }
}
console.log(
  "Light and dark palette checks passed: primary, secondary and muted text contrast.",
);

// Actual-state regression matrix: no timer advances a workflow.
const flow = loadView("../lib/demo-workflow");
const now = new Date().toISOString();
const incident = {
  id: "current-incident",
  service_id: "a",
  state: "ANALYZING",
  detected_at: now,
  events: [],
  runbook_executions: [],
};
const liveData = {
  services: [
    {
      id: "a",
      slug: "demo-service",
      status: "SUSPECTED",
      consecutive_failures: 2,
      consecutive_successes: 0,
      last_checked_at: now,
    },
  ],
  recent_events: [],
  recent_observations: [],
  demo_run: {
    id: "current-run",
    scenario_id: "crash",
    service_id: "a",
    injected_at: now,
    incident_id: null,
    baseline: { http_status: 200, latency_ms: 12, observed_at: now },
    runtime_before: { child_pid: 555, restart_count: 0 },
    failure_threshold: 4,
    verification_threshold: 2,
    check_interval_seconds: 5,
  },
};
assert.equal(flow.demoPhase(null).key, "loading");
assert.equal(flow.demoPhase({ services: [] }).pending, false);
assert.equal(flow.demoPhase(liveData).key, "detection");
assert.equal(
  flow.demoPhase({
    ...liveData,
    demo_run: { ...liveData.demo_run, incident_id: incident.id },
  }).key,
  "loading-incident",
);
for (const [state, events, key, pending] of [
  ["OPEN", [], "opened", true],
  ["ANALYZING", [], "analysis", true],
  [
    "ANALYZING",
    [{ event_type: "ANALYSIS_COMPLETED", at: now }],
    "policy",
    true,
  ],
  ["RECOVERING", [], "recovering", true],
  ["VERIFYING", [], "verifying", true],
  ["AWAITING_APPROVAL", [], "review", false],
  ["ESCALATED", [], "review", false],
  ["CLOSED", [], "closed", false],
  ["RESOLVED", [], "incomplete", false],
]) {
  const phase = flow.demoPhase(liveData, { ...incident, state, events });
  assert.equal(phase.key, key, state);
  assert.equal(phase.pending, pending, state);
}
const resolved = { ...incident, state: "RESOLVED", resolved_at: now };
assert.equal(flow.demoPhase(liveData, resolved).key, "verified");
assert.equal(
  flow.demoPhase(
    { ...liveData, demo_run: { ...liveData.demo_run, reset_at: now } },
    resolved,
  ).key,
  "reset",
);
const renderEvidence = (input, extra = {}) =>
  renderToStaticMarkup(
    React.createElement(evidence.default, { data: input, ...extra }),
  );
const withIncident = (record) => ({
  ...liveData,
  active_incident: record,
  demo_run: { ...liveData.demo_run, incident_id: record.id },
});
const detection = renderEvidence(liveData);
assert.match(detection, /Waiting for health checks/);
assert.match(detection, /aria-valuenow="2"/);
assert.match(detection, /aria-valuemax="4"/);
assert.match(detection, /activity-ring/);
assert.doesNotMatch(detection, /\d+%/);
const analysis = {
  ...incident,
  latest_analysis: {
    provider: "demo_fallback",
    confidence: "medium",
    summary: "Synthetic connection failure",
    reasoning_summary: "Review recorded evidence",
    evidence_event_ids: [],
  },
};
const verifying = renderEvidence({
  ...withIncident({
    ...analysis,
    state: "VERIFYING",
    events: [
      {
        event_type: "VERIFICATION_PROBE_SUCCESS",
        id: "verification-1",
        at: now,
        public_message: "One independent check passed",
      },
    ],
  }),
  services: [{ ...liveData.services[0], consecutive_successes: 1 }],
});
assert.match(verifying, /Verifying successful probes/);
assert.match(verifying, /aria-valuenow="1"/);
assert.match(verifying, /Rule-based demo fallback \/ not Gemini execution/);
assert.match(verifying, /data-state="current"/);
assert.doesNotMatch(verifying, /Recovery independently verified/);
const interruptedVerification = renderEvidence(
  withIncident({
    ...analysis,
    state: "VERIFYING",
    events: [
      {
        id: "old-success",
        event_type: "VERIFICATION_PROBE_SUCCESS",
        at: now,
        public_message: "An earlier check passed",
      },
    ],
  }),
);
assert.match(interruptedVerification, /aria-valuenow="0"/);
assert.doesNotMatch(interruptedVerification, /Recovery independently verified/);
const reviewing = renderEvidence(
  withIncident({ ...analysis, state: "AWAITING_APPROVAL" }),
);
assert.match(reviewing, /Human review required/);
assert.match(reviewing, /Blocked for human review/);
assert.doesNotMatch(reviewing, /activity-ring/);
const resetEvidence = renderEvidence({
  ...withIncident(resolved),
  demo_run: { ...liveData.demo_run, incident_id: resolved.id, reset_at: now },
});
assert.match(resetEvidence, /Run ended by reset/);
assert.match(resetEvidence, /Run reset/);
assert.doesNotMatch(resetEvidence, /activity-ring/);
assert.match(
  renderEvidence(liveData, { operation: "inject" }),
  /Injecting fault/,
);
assert.match(
  renderEvidence(liveData, { operation: "reset" }),
  /Resetting sandbox/,
);
const stale = renderEvidence(liveData, { dataStale: true });
assert.match(stale, /Waiting for fresh evidence/);
assert.doesNotMatch(stale, /activity-ring/);
assert.match(stale, /Retry evidence/);
assert.ok(
  renderDemo(liveData).indexOf("Run demonstration") <
    renderDemo(liveData).indexOf("Recorded incident workflow"),
);
const unavailable = renderToStaticMarkup(
  React.createElement(demo.exports.default, {
    data: liveData,
    dataStale: true,
    currentUser: { token: "test" },
  }),
);
assert.match(unavailable, /Refresh service data before changing the sandbox/);
assert.match(unavailable, /class="ui-button" disabled/);
const clipped = flow.runChecks({
  ...liveData,
  demo_run: {
    ...liveData.demo_run,
    injected_at: "2026-11-13T01:00:00Z",
    reset_at: "2026-11-13T01:00:10Z",
  },
  recent_observations: [
    { id: "before", service_id: "a", observed_at: "2026-11-13T00:59:59Z" },
    { id: "within", service_id: "a", observed_at: "2026-11-13T09:00:05+08:00" },
    { id: "after", service_id: "a", observed_at: "2026-11-13T01:00:11Z" },
    { id: "other", service_id: "b", observed_at: "2026-11-13T01:00:05Z" },
  ],
});
assert.deepEqual(
  clipped.map((check) => check.id),
  ["within"],
);
assert.equal(
  flow.utcTime("2026-11-13T01:00:00"),
  flow.utcTime("2026-11-13T09:00:00+08:00"),
);
assert.match(chartMarkup, /fail-hatch/);
assert.match(chartMarkup, /hatched = fail/);
for (const palette of [lightPalette, darkPalette]) {
  for (const name of [
    "page-bg",
    "surface-bg",
    "neutral-500",
    "neutral-700",
    "neutral-900",
    "action-bg",
    "action-fg",
  ]) {
    const rgb = rgbVariable(palette, name);
    assert.ok(
      rgb.every((channel) => channel === rgb[0]),
      `${name} must be monochrome`,
    );
  }
  const fg = luminance(rgbVariable(palette, "action-fg")),
    bg = luminance(rgbVariable(palette, "action-bg"));
  assert.ok((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 7);
}
assert.match(themeCss, /prefers-reduced-motion/);
assert.match(themeCss, /animation: none !important/);
const sources = fs
  .readdirSync(path.resolve(__dirname, "../src/components"))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) =>
    fs.readFileSync(path.resolve(__dirname, "../src/components", name), "utf8"),
  )
  .join("\n");
assert.doesNotMatch(
  sources,
  /(?:bg|text|border)-(?:blue|rose|amber|emerald|purple|red|green|indigo|sky|teal|orange)-\d/,
);
assert.doesNotMatch(sources, /animate-pulse/);
const pageSource = fs.readFileSync(
  path.resolve(__dirname, "../src/app/page.tsx"),
  "utf8",
);
assert.match(pageSource, /request !== dashboardRequest.current/);
assert.match(pageSource, /key=\{currentTab\}/);
console.log(
  "Live demo checks passed: actual phases, counters, terminal states, provider provenance, stale evidence, run isolation, monochrome charts and reduced motion.",
);

const studio = loadView("../lib/demo-studio");
const studentPanel = loadView("StudentServicePanel");
const reports = loadView("IncidentSummary");
assert.equal(Object.keys(studio.studioScenarios).length, 3);
const untestedStudent = renderToStaticMarkup(
  React.createElement(studentPanel.default, {
    scenario: "crash",
    receipts: [],
    busy: false,
    error: null,
    disabled: false,
    onRequest() {},
  }),
);
assert.match(untestedStudent, /Not tested yet/);
assert.doesNotMatch(untestedStudent, /Service request succeeded/);
const apiError = renderToStaticMarkup(
  React.createElement(studentPanel.default, {
    scenario: "crash",
    receipts: [],
    busy: false,
    error: "API disconnected",
    disabled: true,
    onRequest() {},
  }),
);
assert.match(apiError, /not evidence that the school service failed/);
assert.doesNotMatch(apiError, /Course materials are unreachable/);
const queueStudent = renderToStaticMarkup(
  React.createElement(studentPanel.default, {
    scenario: "attendance_backlog",
    receipts: [
      {
        checked_at: now,
        http_status: 429,
        latency_ms: 5,
        stage: "during",
        scenario_id: "attendance_backlog",
        response: { queued_records: 12 },
      },
    ],
    busy: false,
    error: null,
    disabled: false,
    onRequest() {},
  }),
);
assert.match(queueStudent, /12 synthetic records are queued/);
assert.doesNotMatch(queueStudent, /Service request succeeded/);
assert.equal(
  reports.measuredRecovery({ ...incident, state: "CLOSED", resolved_at: now }),
  "Not verified",
);
const reportMarkup = renderToStaticMarkup(
  React.createElement(reports.IncidentReport, {
    report: {
      incident: { ...analysis, state: "AWAITING_APPROVAL" },
      run: liveData.demo_run,
      scenario: "Database contention",
      checks: [],
      receipts: [],
      runtime: null,
      stale: true,
    },
    generatedAt: now,
  }),
);
assert.match(reportMarkup, /Not verified/);
assert.match(reportMarkup, /No recovery execution recorded/);
assert.match(reportMarkup, /Deterministic demo fallback/);
assert.match(reportMarkup, /Evidence warning/);
assert.doesNotMatch(reportMarkup, /Portal restored/);
assert.match(pageSource, /setCurrentTab\("demo"\)/);
console.log(
  "Demo Studio checks passed: curated stories, unknown and disconnected service states, queue receipts, honest printing and onboarding.",
);
const failedActionMarkup = renderToStaticMarkup(
  React.createElement(reports.default, {
    incident: {
      ...analysis,
      state: "ESCALATED",
      auto_recovery_attempted: true,
      runbook_executions: [
        {
          id: "failed-recovery",
          runbook_id: "RESTART_DEMO_CHILD_SERVICE",
          status: "FAILED",
        },
      ],
    },
    run: liveData.demo_run,
    scenario: "Portal crash",
    checks: [],
    receipts: [],
    runtime: null,
    stale: false,
  }),
);
assert.match(failedActionMarkup, /Recovery needs human attention/);
assert.doesNotMatch(failedActionMarkup, /Unsafe restart prevented/);
