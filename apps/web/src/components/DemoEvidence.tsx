"use client";

import React, { useEffect, useState } from "react";
import { DashboardData, Incident } from "../types";

interface Runtime {
  observed_at: string;
  child_running: boolean | null;
  child_pid: number | null;
  mode: string | null;
  restart_count: number | null;
  last_action: string | null;
}
const clock = (value?: string | null) =>
  value
    ? new Date(
        /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`,
      ).toLocaleTimeString("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        hour12: false,
      })
    : "Not recorded";

export function evidenceSteps(incident: Incident | null | undefined) {
  const events = incident?.events || [];
  const recorded = (type: string) =>
    events.find((event) => event.event_type === type);
  const execution = [...(incident?.runbook_executions || [])].sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  )[0];
  const paused =
    incident?.state === "AWAITING_APPROVAL" || incident?.state === "ESCALATED";
  return [
    {
      title: "Detection",
      at: incident?.detected_at,
      detail: incident
        ? `Incident ${incident.id.slice(0, 8)} created`
        : "No incident recorded",
    },
    {
      title: "Analysis",
      at: recorded("ANALYSIS_COMPLETED")?.at,
      detail: incident?.latest_analysis
        ? `${incident.latest_analysis.provider === "demo_fallback" ? "Demo fallback - not a live AI call" : incident.latest_analysis.provider === "gemini_api" ? "Gemini API result" : "Gemini Enterprise result"} / ${incident.latest_analysis.confidence} confidence`
        : "No result recorded",
    },
    {
      title: "Policy",
      at: recorded("POLICY_EVALUATED")?.at,
      detail:
        recorded("POLICY_EVALUATED")?.public_message ||
        "No policy verdict recorded",
    },
    {
      title: "Recovery",
      at: execution?.started_at || recorded("RECOVERY_STARTED")?.at,
      detail: execution
        ? `${execution.runbook_id}: ${execution.status}`
        : paused
          ? "Blocked for human review; no execution recorded"
          : "No recovery execution recorded",
    },
    {
      title: "Verification",
      at: incident?.resolved_at,
      detail: incident?.resolved_at
        ? "Recovery independently verified"
        : incident?.state === "CLOSED"
          ? "Administratively closed; recovery not verified"
          : `${events.filter((event) => event.event_type === "VERIFICATION_PROBE_SUCCESS").length} successful verification events recorded`,
    },
  ];
}

export default function DemoEvidence({
  data,
  token,
}: {
  data: DashboardData | null;
  token?: string;
}) {
  const [record, setRecord] = useState<Incident | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const active = data?.active_incident;
  const latestId =
    active?.id ||
    [...(data?.recent_events || [])].sort((a, b) => b.at.localeCompare(a.at))[0]
      ?.incident_id;
  const lastEventId = data?.recent_events?.[0]?.id;
  useEffect(() => {
    if (!latestId || active) return;
    const controller = new AbortController();
    setIncidentError(null);
    fetch(`/api/v1/incidents/${encodeURIComponent(latestId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not load the completed incident. Its outcome is not verified in this view.",
          );
        setRecord(await response.json());
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setIncidentError(
            reason instanceof Error
              ? reason.message
              : "Incident history unavailable.",
          );
      });
    return () => controller.abort();
  }, [latestId, active, lastEventId]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/api/v1/demo/runtime", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Runner could not be verified. Displayed runtime values may be stale.",
          );
        setRuntime(await response.json());
        setRuntimeError(null);
      } catch (reason) {
        if (!controller.signal.aborted)
          setRuntimeError(
            reason instanceof Error ? reason.message : "Runner unavailable.",
          );
      }
    }
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [token, active?.state]);
  const incident = active || (record?.id === latestId ? record : null);
  const service =
    data?.services.find((item) => item.id === incident?.service_id) ||
    data?.services[0];
  const checks = [...(data?.recent_observations || [])]
    .filter((check) => check.service_id === service?.id)
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
    .slice(0, 12);
  const latest = checks[0];
  const steps = evidenceSteps(incident);

  return (
    <section
      className="space-y-5 border-y border-stone-200 py-6"
      aria-labelledby="demo-evidence-title"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="demo-evidence-title"
            className="text-lg font-semibold text-stone-900"
          >
            Live execution evidence
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Server records and supervisor observations. No timed progress
            simulation.
          </p>
        </div>
        <span className="font-mono text-xs text-stone-500">
          {incident
            ? `${active ? "Active" : "Latest recorded"} incident: ${incident.id.slice(0, 8)} / ${incident.state}`
            : "No incident loaded"}
        </span>
      </header>
      {(runtimeError || incidentError) && (
        <p role="alert" className="text-sm text-amber-800">
          {runtimeError || incidentError}
        </p>
      )}
      <dl className="grid gap-4 rounded-md border border-stone-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-stone-500">Child process</dt>
          <dd className="mt-1 font-mono text-sm text-stone-800">
            {runtime
              ? runtime.child_running
                ? `Running / PID ${runtime.child_pid ?? "unknown"}`
                : "Stopped"
              : token
                ? "Awaiting supervisor response"
                : "Sign in to inspect runner"}
          </dd>
          <p className="mt-1 text-xs text-stone-500">
            Observed {clock(runtime?.observed_at)} MYT
          </p>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Supervisor restarts</dt>
          <dd className="mt-1 font-mono text-sm text-stone-800">
            {runtime?.restart_count ?? "Unverified"}
          </dd>
          <p className="mt-1 text-xs text-stone-500">
            Since supervisor startup; mode: {runtime?.mode || "unverified"}
          </p>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Latest health probe</dt>
          <dd className="mt-1 font-mono text-sm text-stone-800">
            {latest
              ? `${latest.success ? "PASS" : "FAIL"} / ${latest.http_status ?? "No HTTP response"}`
              : "No probe recorded"}
          </dd>
          <p className="mt-1 text-xs text-stone-500">
            {latest
              ? `${latest.latency_ms.toFixed(1)} ms at ${clock(latest.observed_at)} MYT`
              : "Waiting for monitor evidence"}
          </p>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Consecutive checks</dt>
          <dd className="mt-1 font-mono text-sm text-stone-800">
            {service
              ? `${service.consecutive_failures} failed / ${service.consecutive_successes} passed`
              : "No service loaded"}
          </dd>
          <p className="mt-1 text-xs text-stone-500">
            Counters reported by the monitor
          </p>
        </div>
      </dl>
      <ol
        className="grid gap-3 md:grid-cols-5"
        aria-label="Recorded incident workflow"
      >
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={`min-w-0 border-t-2 pt-3 ${step.at ? "border-stone-500" : "border-stone-200"}`}
          >
            <p className="text-sm font-medium text-stone-800">
              <span className="mr-2 font-mono text-xs text-stone-500">
                0{index + 1}
              </span>
              {step.title}
            </p>
            <p className="mt-2 text-xs text-stone-500">
              {clock(step.at)}
              {step.at ? " MYT" : ""}
            </p>
            <p className="mt-2 break-words text-xs leading-relaxed text-stone-700">
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
      {incident?.latest_analysis && (
        <details className="border-t border-stone-200 pt-2">
          <summary className="cursor-pointer py-2 text-sm text-stone-700">
            Analysis result and reasoning
          </summary>
          <p className="mt-2 text-sm text-stone-800">
            {incident.latest_analysis.summary}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            {incident.latest_analysis.reasoning_summary}
          </p>
        </details>
      )}
      <details className="border-t border-stone-200 pt-2" open>
        <summary className="cursor-pointer py-2 text-sm font-medium text-stone-700">
          Recent probe receipts ({checks.length})
        </summary>
        <ol className="mt-2 divide-y divide-stone-200">
          {checks.map((check) => (
            <li key={check.id} className="py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 py-2 text-xs text-stone-700">
                  <span className="font-mono">
                    {clock(check.observed_at)} MYT
                  </span>
                  <span
                    className={
                      check.success ? "text-emerald-700" : "text-rose-700"
                    }
                  >
                    {check.success ? "PASS" : "FAIL"} /{" "}
                    {check.http_status ?? "No response"}
                  </span>
                  <span className="font-mono">
                    {check.latency_ms.toFixed(1)} ms
                  </span>
                  <span className="text-stone-500">Inspect receipt</span>
                </summary>
                <p className="my-2 break-all font-mono text-xs text-stone-500">
                  Probe {check.id} / {check.error_type || "No error"}
                </p>
                <pre className="whitespace-pre-wrap break-all text-xs text-stone-600">
                  {check.sanitized_details || "No additional details recorded."}
                </pre>
              </details>
            </li>
          ))}
        </ol>
        {!checks.length && (
          <p className="py-4 text-sm text-stone-500">
            No probe receipts yet. Nothing is being presented as verified.
          </p>
        )}
      </details>
      {incident && (
        <details className="border-t border-stone-200 pt-2">
          <summary className="cursor-pointer py-2 text-sm text-stone-700">
            Incident event journal ({incident.events.length})
          </summary>
          <ol className="mt-2 divide-y divide-stone-200">
            {[...incident.events]
              .sort((a, b) => a.sequence - b.sequence)
              .map((event) => (
                <li key={event.id} className="py-3 text-xs">
                  <p className="font-mono text-stone-500">
                    #{event.sequence} / {clock(event.at)} MYT / {event.actor_id}
                  </p>
                  <p className="mt-1 break-words text-stone-800">
                    {event.public_message}
                  </p>
                </li>
              ))}
          </ol>
        </details>
      )}
    </section>
  );
}
