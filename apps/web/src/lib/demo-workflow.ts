import { DashboardData, Incident } from "../types";

export const utcTime = (value: string) =>
  new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`).getTime();
const clockFormatter = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
export const formatClock = (value?: string | null) =>
  value
    ? clockFormatter.format(new Date(utcTime(value))) + " MYT"
    : "Not recorded";

export function demoPhase(
  data: DashboardData | null,
  incident?: Incident | null,
) {
  const run = data?.demo_run;
  if (!data)
    return {
      key: "loading",
      label: "Loading service evidence",
      pending: true,
      step: -1,
    };
  if (run?.reset_at)
    return {
      key: "reset",
      label: "Run ended by reset",
      pending: false,
      step: -1,
    };
  if (incident?.state === "CLOSED")
    return {
      key: "closed",
      label: "Closed without verified recovery",
      pending: false,
      step: -1,
    };
  if (incident?.state === "RESOLVED")
    return {
      key: incident.resolved_at ? "verified" : "incomplete",
      label: incident.resolved_at
        ? "Recovery independently verified"
        : "Resolution record incomplete",
      pending: false,
      step: 6,
    };
  if (["AWAITING_APPROVAL", "ESCALATED"].includes(incident?.state || ""))
    return {
      key: "review",
      label: "Human review required",
      pending: false,
      step: 3,
    };
  if (incident?.state === "VERIFYING")
    return {
      key: "verifying",
      label: "Verifying successful probes",
      pending: true,
      step: 4,
    };
  if (incident?.state === "RECOVERING")
    return {
      key: "recovering",
      label: "Executing approved recovery",
      pending: true,
      step: 3,
    };
  if (incident?.state === "OPEN")
    return {
      key: "opened",
      label: "Waiting for incident analysis",
      pending: true,
      step: 1,
    };
  if (incident) {
    const analyzed = incident.events?.some(
      (event) => event.event_type === "ANALYSIS_COMPLETED",
    );
    return {
      key: analyzed ? "policy" : "analysis",
      label: analyzed ? "Evaluating recovery policy" : "Analyzing evidence",
      pending: true,
      step: analyzed ? 2 : 1,
    };
  }
  if (run)
    return {
      key: run.incident_id ? "loading-incident" : "detection",
      label: run.incident_id
        ? "Loading recorded incident"
        : "Waiting for health checks",
      pending: true,
      step: run.incident_id ? -1 : 0,
    };
  return {
    key: "ready",
    label: "Ready when you are",
    pending: false,
    step: -1,
  };
}

export function runChecks(data: DashboardData | null, serviceId?: string) {
  const run = data?.demo_run;
  return [...(data?.recent_observations || [])]
    .filter(
      (check) =>
        check.service_id === (run?.service_id || serviceId) &&
        (!run || utcTime(check.observed_at) >= utcTime(run.injected_at)) &&
        (!run?.reset_at || utcTime(check.observed_at) <= utcTime(run.reset_at)),
    )
    .sort((a, b) => utcTime(a.observed_at) - utcTime(b.observed_at));
}
