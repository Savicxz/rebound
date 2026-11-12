"use client";

import React, { useEffect, useState } from "react";
import {
  Check,
  Circle,
  Download,
  Pause,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import { DashboardData, Incident } from "../types";
import ActivityIndicator from "./ActivityIndicator";
import {
  demoPhase,
  formatClock,
  runChecks,
  utcTime,
} from "../lib/demo-workflow";

interface Runtime {
  observed_at: string;
  child_running: boolean | null;
  child_pid: number | null;
  mode: string | null;
  restart_count: number | null;
  last_action: string | null;
}
export function evidenceSteps(incident: Incident | null | undefined) {
  const events = incident?.events || [];
  const recorded = (type: string) =>
    events.find((event) => event.event_type === type);
  const execution = [...(incident?.runbook_executions || [])].sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  )[0];
  const paused = ["AWAITING_APPROVAL", "ESCALATED"].includes(
    incident?.state || "",
  );
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
      at: incident?.state === "RESOLVED" ? incident.resolved_at : undefined,
      detail:
        incident?.state === "RESOLVED" && incident.resolved_at
          ? "Recovery independently verified"
          : incident?.state === "CLOSED"
            ? "Administratively closed; recovery not verified"
            : `${events.filter((event) => event.event_type === "VERIFICATION_PROBE_SUCCESS").length} successful verification events recorded`,
    },
  ];
}
function Counter({
  count,
  threshold,
  label,
}: {
  count: number;
  threshold: number;
  label: string;
}) {
  const bound = Math.max(1, threshold);
  return (
    <div className="mt-4 max-w-sm">
      <p className="mb-2 flex justify-between gap-3 text-xs text-stone-600">
        <span>{label}</span>
        <span className="font-mono">
          {Math.min(count, bound)} of {bound}
        </span>
      </p>
      <div
        className="probe-meter"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={bound}
        aria-valuenow={Math.min(count, bound)}
      >
        {Array.from({ length: Math.min(bound, 20) }, (_, index) => (
          <span
            key={index}
            data-recorded={
              index <
              Math.floor((Math.min(count, bound) / bound) * Math.min(bound, 20))
            }
          />
        ))}
      </div>
    </div>
  );
}

export default function DemoEvidence({
  data,
  token,
  operation = null,
  dataStale = false,
  scenarioTitle,
}: {
  data: DashboardData | null;
  token?: string;
  operation?: "inject" | "reset" | null;
  dataStale?: boolean;
  scenarioTitle?: string;
}) {
  const [record, setRecord] = useState<Incident | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const run = data?.demo_run;
  const active = run
    ? data?.active_incident?.id === run.incident_id
      ? data.active_incident
      : null
    : data?.active_incident;
  const latestId = run
    ? run.incident_id
    : active?.id ||
      [...(data?.recent_events || [])].sort((a, b) =>
        b.at.localeCompare(a.at),
      )[0]?.incident_id;
  const lastEventId = data?.recent_events?.[0]?.id;
  useEffect(() => {
    setIncidentError(null);
  }, [run?.id, latestId, !!active]);
  useEffect(() => {
    if (!latestId || active) return;
    const controller = new AbortController();
    fetch(`/api/v1/incidents/${encodeURIComponent(latestId)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not load the incident outcome. Previous evidence may be stale.",
          );
        const next: Incident = await response.json();
        if (!controller.signal.aborted) {
          setRecord(next);
          setIncidentError(null);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setIncidentError(
            reason instanceof Error ? reason.message : "Incident unavailable",
          );
      });
    return () => controller.abort();
  }, [latestId, !!active, lastEventId, retry]);
  useEffect(() => {
    if (!token) {
      setRuntime(null);
      return;
    }
    const controller = new AbortController();
    let inFlight = false;
    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/v1/demo/runtime", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!response.ok)
          throw new Error(
            "Supervisor observations unavailable. Previous runtime values may be stale.",
          );
        const next: Runtime = await response.json();
        if (!controller.signal.aborted) {
          setRuntime(next);
          setRuntimeError(null);
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setRuntimeError(
            reason instanceof Error ? reason.message : "Runner unavailable",
          );
      } finally {
        inFlight = false;
      }
    }
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [token, retry]);
  useEffect(() => {
    setDownloaded(false);
    setDownloadError(null);
  }, [latestId, run?.id]);
  const incident = active || (record?.id === latestId ? record : null);
  const service =
    data?.services.find(
      (item) => item.id === (run?.service_id || incident?.service_id),
    ) || data?.services[0];
  const checks = runChecks(data, service?.id);
  const recent = checks.slice(-24);
  const latest = checks.at(-1);
  const phase = demoPhase(data, incident);
  const monitorStale =
    !!data &&
    !!run &&
    phase.pending &&
    (service?.last_checked_at
      ? Date.now() - utcTime(service.last_checked_at) >
        Math.max(15000, run.check_interval_seconds * 3000)
      : Date.now() - utcTime(run.injected_at) > 15000);
  const stale = dataStale || monitorStale || !!incidentError;
  const pending = !!operation || (phase.pending && !stale);
  const label =
    operation === "inject"
      ? "Injecting fault"
      : operation === "reset"
        ? "Resetting sandbox"
        : stale
          ? "Waiting for fresh evidence"
          : phase.label;
  const steps = evidenceSteps(incident);
  const events = incident?.events || [];
  const recorded = (type: string) =>
    events.find((event) => event.event_type === type);
  const verified = incident?.state === "RESOLVED" && !!incident.resolved_at;
  const review = phase.key === "review";
  const reset = ["reset", "closed"].includes(phase.key);
  const successfulVerifications = service?.consecutive_successes;
  const failureCount =
    phase.key === "detection" ? service?.consecutive_failures || 0 : 0;
  const recoveryDone =
    !!recorded("RECOVERY_ACTION_COMPLETED") ||
    !!incident?.runbook_executions?.some((item) => item.status === "SUCCESS");
  const completed = [
    !!incident?.detected_at,
    !!recorded("ANALYSIS_COMPLETED"),
    !!recorded("POLICY_EVALUATED"),
    recoveryDone || !!recorded("HUMAN_REVIEW_REQUIRED"),
    verified,
  ];
  const duration = verified
    ? Math.max(
        0,
        Math.round(
          (utcTime(incident!.resolved_at!) - utcTime(incident!.detected_at)) /
            1000,
        ),
      )
    : null;
  async function download() {
    setDownloadError(null);
    try {
      const report = {
        exported_at: new Date().toISOString(),
        simulated: true,
        outcome: phase.key,
        incident,
        demo_run: run,
        recent_probe_sample: checks,
        runtime_observation: token ? runtime : null,
        warnings: [
          dataStale && "Dashboard data may be stale",
          monitorStale && "Monitor observations are stale",
          incidentError,
          runtimeError,
        ].filter(Boolean),
        note: "One synthetic workload. Probe history is bounded. Runtime observations may be newer than the incident. A reset is not verified recovery.",
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `rebound-${run?.id || incident?.id || "evidence"}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch {
      setDownloadError("Evidence could not be downloaded. Please retry.");
    }
  }
  return (
    <section
      aria-labelledby="demo-evidence-title"
      className="ui-panel overflow-hidden"
    >
      <div
        className={`p-5 sm:p-6 ${review ? "border-l-4 border-dashed border-stone-500" : reset ? "state-reset" : ""}`}
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="ui-eyebrow">Live run / recorded evidence</p>
            {run && (
              <p className="mt-2 text-sm font-medium text-stone-700">
                {scenarioTitle || run.scenario_id.replaceAll("_", " ")} /{" "}
                <span className="font-mono text-xs">{run.id.slice(0, 8)}</span>
              </p>
            )}
            <div
              role="status"
              aria-live="polite"
              className="mt-3 flex items-center gap-3"
            >
              {pending ? (
                <ActivityIndicator className="!h-8 !w-8" />
              ) : reset ? (
                <RotateCcw aria-hidden="true" className="h-6 w-6" />
              ) : verified ? (
                <Check aria-hidden="true" className="h-7 w-7" />
              ) : review || stale ? (
                <Pause aria-hidden="true" className="h-6 w-6" />
              ) : (
                <Circle aria-hidden="true" className="h-6 w-6" />
              )}
              <h2
                id="demo-evidence-title"
                className="text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl"
              >
                {label}
              </h2>
            </div>
          </div>
          <button
            className="ui-button"
            disabled={!incident && !run}
            onClick={download}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {downloaded ? "Download again" : "Download evidence JSON"}
          </button>
        </header>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-stone-600">
          {stale
            ? "Progress is paused visually until fresh server evidence arrives. Displayed records are retained; no recovery is being inferred."
            : operation
              ? "The control request is in flight. Subsequent progress comes from the independent monitor."
              : reset
                ? "This demonstration ended administratively. Earlier records are retained; a reset does not prove recovery."
                : verified
                  ? "The approved action completed and independent healthy probes confirmed recovery."
                  : review
                    ? incident?.latest_analysis?.reasoning_summary ||
                      "The policy stopped automatic execution. Human investigation is required."
                    : phase.key === "detection"
                      ? `${failureCount} of ${run?.failure_threshold || 3} failed checks recorded. Checks run every ${run?.check_interval_seconds || 5} seconds; an incident opens only after the configured threshold.`
                      : phase.key === "loading-incident"
                        ? "An incident ID is recorded. Loading its event history before showing an outcome."
                        : incident?.latest_analysis?.summary ||
                          (incident
                            ? "Follow the recorded investigation below. No outcome is assumed."
                            : "Run a scenario above to capture a healthy baseline and introduce a controlled failure.")}
        </p>
        {data && phase.key === "detection" && !stale && (
          <Counter
            count={failureCount}
            threshold={run?.failure_threshold || 3}
            label="Recorded failed probes"
          />
        )}
        {phase.key === "verifying" &&
          typeof successfulVerifications === "number" && (
            <Counter
              count={successfulVerifications}
              threshold={run?.verification_threshold || 2}
              label="Consecutive healthy verification probes"
            />
          )}
        {(stale || runtimeError || downloadError) && (
          <div className="ui-notice mt-4 flex flex-wrap items-center justify-between gap-3">
            <p>
              {downloadError ||
                incidentError ||
                (monitorStale
                  ? "The monitor has not reported recently. Check the worker process; background polling continues."
                  : dataStale
                    ? "Dashboard updates are unavailable. Automatic retries continue."
                    : runtimeError)}
            </p>
            <button
              className="ui-button"
              onClick={() => {
                setRetry((value) => value + 1);
                if (downloadError) download();
              }}
            >
              Retry evidence
            </button>
          </div>
        )}
        {downloaded && (
          <p role="status" className="mt-3 text-xs text-stone-600">
            JSON download requested. The report includes synthetic-data and
            stale-evidence disclosures.
          </p>
        )}
        {run && (
          <dl className="mt-6 grid gap-5 border-t border-stone-200 pt-5 sm:grid-cols-3">
            <div>
              <dt className="ui-eyebrow">Before injection</dt>
              <dd className="mt-2 font-mono text-sm text-stone-900">
                HTTP {run.baseline.http_status} /{" "}
                {run.baseline.latency_ms.toFixed(1)} ms
              </dd>
              <p className="mt-1 text-xs text-stone-500">
                {formatClock(run.baseline.observed_at)}
              </p>
            </div>
            <div>
              <dt className="ui-eyebrow">
                {reset ? "Last probe before reset" : "Latest run probe"}
              </dt>
              <dd className="mt-2 font-mono text-sm text-stone-900">
                {latest
                  ? `${latest.success ? "PASS" : "FAIL"} / ${latest.http_status ?? "No response"} / ${latest.latency_ms.toFixed(1)} ms`
                  : "Not recorded"}
              </dd>
              <p className="mt-1 text-xs text-stone-500">
                {formatClock(latest?.observed_at)}
              </p>
            </div>
            <div>
              <dt className="ui-eyebrow">Verified recovery time</dt>
              <dd className="mt-2 font-mono text-sm text-stone-900">
                {duration == null ? "Not verified" : `${duration} seconds`}
              </dd>
              <p className="mt-1 text-xs text-stone-500">
                {verified
                  ? "From detection to recorded resolution"
                  : review
                    ? "Stopped for human investigation"
                    : reset
                      ? "Closed without claiming recovery"
                      : "Awaiting independent evidence"}
              </p>
            </div>
          </dl>
        )}
      </div>
      {!data ? (
        <div
          aria-label="Loading recorded workflow"
          aria-busy="true"
          className="grid gap-4 border-t border-stone-200 p-6 sm:grid-cols-5"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="skeleton h-20" />
          ))}
        </div>
      ) : (
        <ol
          className="grid sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Recorded incident workflow"
        >
          {steps.map((step, index) => {
            const current = phase.step === index && pending && !operation;
            const blocked =
              (review && index >= 3) || (reset && !completed[index]);
            const status = blocked
              ? "blocked"
              : current
                ? "current"
                : completed[index]
                  ? "complete"
                  : "waiting";
            return (
              <li
                key={step.title}
                className="workflow-step"
                data-state={status}
                aria-current={current ? "step" : undefined}
              >
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  {current ? (
                    <ActivityIndicator className="!h-4 !w-4" />
                  ) : completed[index] && !blocked ? (
                    <Check aria-hidden="true" className="h-4 w-4" />
                  ) : blocked ? (
                    <Pause aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <span className="font-mono">0{index + 1}</span>
                  )}
                  <span>
                    {current
                      ? "In progress"
                      : blocked
                        ? review
                          ? "Review / paused"
                          : "Ended"
                        : completed[index]
                          ? "Recorded"
                          : "Awaiting evidence"}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-stone-900">
                  {index === 3 && review ? "Human review" : step.title}
                </h3>
                <p className="mt-2 font-mono text-[11px] text-stone-500">
                  {formatClock(
                    index === 3 && review
                      ? recorded("HUMAN_REVIEW_REQUIRED")?.at
                      : step.at,
                  )}
                </p>
                <p className="mt-2 break-words text-xs leading-relaxed text-stone-600">
                  {step.detail}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <div className="border-t border-stone-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="ui-eyebrow">Evidence inspector</p>
          <span
            className={`state-tag ${reset ? "state-reset" : verified ? "state-verified" : review ? "state-review" : ""}`}
          >
            {(reset ? "Run reset" : incident?.state) ||
              (run ? "Awaiting incident" : "No run recorded")}
          </span>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Synthetic services only. No timed progress simulation.{" "}
          {incident ? `Incident ${incident.id}` : "No incident loaded"}
        </p>
        {incident?.latest_analysis && (
          <details className="mt-4 border-t border-stone-200 pt-2">
            <summary className="text-sm font-medium text-stone-800">
              Analysis source and reasoning
            </summary>
            <div className="mt-3 space-y-3 text-sm text-stone-600">
              <span className="state-tag">
                {incident.latest_analysis.provider === "demo_fallback"
                  ? "Rule-based demo fallback / not Gemini execution"
                  : incident.latest_analysis.provider === "gemini_api"
                    ? "Recorded Gemini API analysis"
                    : "Recorded Enterprise analysis"}
              </span>
              <p>{incident.latest_analysis.summary}</p>
              <p>{incident.latest_analysis.reasoning_summary}</p>
              {incident.latest_analysis.fallback_reason && (
                <p className="text-xs">
                  Fallback reason: {incident.latest_analysis.fallback_reason}
                </p>
              )}
            </div>
          </details>
        )}
        <details className="mt-3 border-t border-stone-200 pt-2">
          <summary className="text-sm font-medium text-stone-800">
            Live process and monitor counters
          </summary>
          <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-stone-500">
                Process / observed {formatClock(runtime?.observed_at)}
              </dt>
              <dd className="mt-1 font-mono">
                {runtime
                  ? runtime.child_running
                    ? `Running / PID ${runtime.child_pid ?? "unknown"}`
                    : "Stopped"
                  : token
                    ? "Awaiting supervisor response"
                    : "Sign in to inspect runner"}
              </dd>
              {run && (
                <p className="mt-1 text-xs text-stone-500">
                  Before injection: PID{" "}
                  {run.runtime_before.child_pid ?? "unknown"}
                </p>
              )}
            </div>
            <div>
              <dt className="text-xs text-stone-500">Supervisor restarts</dt>
              <dd className="mt-1 font-mono">
                {runtime?.restart_count ?? "Unverified"}
              </dd>
              <p className="mt-1 text-xs text-stone-500">
                Mode: {runtime?.mode || "unverified"}
                {runtimeError ? " / stale" : ""}
              </p>
            </div>
            <div>
              <dt className="text-xs text-stone-500">
                Consecutive checks / live service
              </dt>
              <dd className="mt-1 font-mono">
                {service
                  ? `${service.consecutive_failures} failed / ${service.consecutive_successes} passed`
                  : "Not loaded"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Latest run probe</dt>
              <dd className="mt-1 font-mono">
                {latest
                  ? `${latest.success ? "PASS" : "FAIL"} / ${latest.http_status ?? "No HTTP response"}`
                  : "No probe recorded"}
              </dd>
            </div>
          </dl>
        </details>
        <details className="mt-3 border-t border-stone-200 pt-2">
          <summary className="text-sm font-medium text-stone-800">
            Recent probe receipts ({recent.length})
          </summary>
          <p className="mt-2 text-xs text-stone-500">
            Most recent 24 available checks within this run. History is bounded
            by the dashboard sample.
          </p>
          <ol className="mt-3 divide-y divide-stone-200">
            {recent.map((check) => (
              <li key={check.id}>
                <details>
                  <summary className="flex flex-wrap justify-between gap-2 py-3 text-xs text-stone-700">
                    <span className="font-mono">
                      {formatClock(check.observed_at)}
                    </span>
                    <span
                      className={`state-tag ${check.success ? "" : "state-review"}`}
                    >
                      {check.success ? "PASS" : "FAIL"} /{" "}
                      {check.http_status ?? "No response"}
                    </span>
                    <span className="font-mono">
                      {check.latency_ms.toFixed(1)} ms
                    </span>
                    <span>
                      Inspect receipt
                      <ArrowUpRight
                        aria-hidden="true"
                        className="ml-1 inline h-3 w-3"
                      />
                    </span>
                  </summary>
                  <p className="mb-2 break-all font-mono text-xs text-stone-500">
                    Probe {check.id} / {check.error_type || "No error"}
                  </p>
                  <pre className="mb-3 whitespace-pre-wrap break-all text-xs text-stone-600">
                    {check.sanitized_details ||
                      "No additional details recorded."}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
          {!recent.length && (
            <p className="py-4 text-sm text-stone-500">
              No probe receipts yet. Nothing is being presented as verified.
            </p>
          )}
        </details>
        {incident && (
          <details className="mt-3 border-t border-stone-200 pt-2" open>
            <summary className="text-sm font-medium text-stone-800">
              Incident event timeline ({events.length})
            </summary>
            <ol className="ml-1 mt-5">
              {[...events]
                .sort((a, b) => a.sequence - b.sequence)
                .map((event) => (
                  <li key={event.id} className="timeline-entry">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xs font-medium capitalize text-stone-800">
                        {event.event_type.toLowerCase().replaceAll("_", " ")}
                      </p>
                      <p className="font-mono text-[11px] text-stone-500">
                        {formatClock(event.at)}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-stone-600">
                      {event.public_message}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-stone-500">
                      #{event.sequence} / {event.actor_id}
                    </p>
                  </li>
                ))}
            </ol>
            {!events.length && (
              <p className="mt-3 text-sm text-stone-500">
                No timeline events recorded yet.
              </p>
            )}
          </details>
        )}
      </div>
    </section>
  );
}
