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
  const source = path.resolve(__dirname, "../src/components", `${name}.tsx`);
  const loaded = new Module(source, module);
  loaded.filename = source;
  loaded.paths = module.paths;
  loaded.require = component.require;
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
      : name.startsWith("./")
        ? loadView(name.slice(2))
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
      currentUser: { username: "operator", role: "OPERATOR" },
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
assert.match(renderDemo(demoData), /paused for human review/);
assert.match(renderDemo(demoData), /Expected result/);
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
assert.match(navigation, /Reconnecting/);
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
