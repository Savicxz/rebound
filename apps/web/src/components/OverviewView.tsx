"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, X } from "lucide-react";
import { DashboardData } from "../types";
import MonitoringCharts from "./MonitoringCharts";

interface OverviewViewProps {
  data: DashboardData | null;
  loadError?: string | null;
  currentUser: { username: string; role: string };
  onRefresh: () => void;
  onApproveRunbook: (incidentId: string, runbookId: string) => Promise<void>;
  onRejectRunbook: (incidentId: string, runbookId: string) => Promise<void>;
  onTriggerFailure: (type: import("../types").DemoScenarioId) => Promise<void>;
  onResetDemo: () => Promise<void>;
  onNavigate?: (tab: string) => void;
}

const readable = (value: string) => value.toLowerCase().replaceAll("_", " ");
const time = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        hour12: false,
      }) + " MYT"
    : "Not recorded yet";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 text-sm text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

export default function OverviewView({
  data,
  loadError,
  currentUser,
  onApproveRunbook,
  onRejectRunbook,
  onNavigate,
}: OverviewViewProps) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!data)
    return (
      <section aria-busy={!loadError} className="space-y-5">
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p role="status" className="text-sm text-slate-500">
          {loadError
            ? "Service data is unavailable. Use Refresh data to retry."
            : "Loading service health and recent incidents..."}
        </p>
        {!loadError && (
          <div aria-hidden="true" className="animate-pulse space-y-4">
            <div className="h-24 rounded-lg bg-slate-100/60" />
            <div className="h-64 rounded-lg bg-slate-100/40" />
          </div>
        )}
      </section>
    );

  const { metrics, services, active_incident: incident, recent_events } = data;
  const selectedService =
    services.find((item) => item.id === selectedServiceId) ||
    services.find((item) => item.id === incident?.service_id) ||
    services[0];
  const analysis = incident?.latest_analysis;
  const service = services.find((item) => item.id === incident?.service_id);
  const events = incident
    ? [
        ...incident.events,
        ...recent_events.filter((event) => event.incident_id === incident.id),
      ]
    : [];
  const progress = incident
    ? [
        { label: "Detected", at: incident.detected_at },
        {
          label: "Analysed",
          at: events.find((event) => event.event_type === "ANALYSIS_COMPLETED")
            ?.at,
        },
        {
          label: "Recovery started",
          at:
            events.find((event) => event.event_type === "RECOVERY_STARTED")
              ?.at || incident.runbook_executions?.[0]?.started_at,
        },
        {
          label: "Verified",
          at:
            incident.resolved_at ||
            events.find((event) => event.event_type === "INCIDENT_RESOLVED")
              ?.at,
        },
      ]
    : [];
  const needsReview = incident?.state === "AWAITING_APPROVAL";

  async function act(kind: "approve" | "reject") {
    if (!incident) return;
    setPending(kind);
    setActionError(null);
    try {
      await (kind === "approve" ? onApproveRunbook : onRejectRunbook)(
        incident.id,
        analysis?.recommended_runbook_id || "NONE",
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Action failed. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-7">
      <header className="border-b border-stone-200 pb-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
          <span>Service watch / Service sandbox</span>
          {onNavigate && (
            <button
              className="min-h-11 text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-stone-950"
              onClick={() => onNavigate("demo")}
            >
              Open demonstration scenarios
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="max-w-2xl text-[30px] font-semibold leading-tight tracking-[-0.035em] text-stone-900 sm:text-[36px]">
              {selectedService?.display_name || "No services configured"}
            </h1>
            <p className="mt-3 flex items-center gap-2 text-sm text-stone-500">
              <span
                className={`h-2 w-2 rounded-full ${selectedService?.status === "HEALTHY" ? "bg-emerald-600" : "bg-amber-600"}`}
                aria-hidden="true"
              />
              {selectedService
                ? readable(selectedService.status)
                : "Awaiting configuration"}
              <span className="mx-1 text-stone-300">/</span>Last checked{" "}
              {selectedService?.last_checked_at
                ? time(selectedService.last_checked_at)
                : "Not checked yet"}
            </p>
          </div>
          <span className="pt-2 font-mono text-xs text-stone-400">
            {selectedService?.slug}
          </span>
        </div>
        {services.length > 1 && (
          <nav
            aria-label="Monitored services"
            className="mt-5 flex flex-wrap gap-x-5 gap-y-2"
          >
            {services.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedServiceId(item.id)}
                aria-pressed={selectedService?.id === item.id}
                className={`min-h-11 border-b py-2 text-xs ${selectedService?.id === item.id ? "border-stone-900 font-medium text-stone-900" : "border-transparent text-stone-500 hover:text-stone-950"}`}
              >
                {item.display_name}
              </button>
            ))}
          </nav>
        )}
      </header>

      {incident ? (
        <section
          aria-labelledby="active-incident-title"
          className="border-y border-stone-200 bg-amber-50/30"
        >
          <div className="border-l-4 border-amber-400 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-amber-800">
                  {needsReview
                    ? "Administrator review needed"
                    : "Active incident"}
                </p>
                <h2
                  id="active-incident-title"
                  className="mt-1 text-lg font-semibold text-slate-900"
                >
                  {incident.title}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Detected {time(incident.detected_at)} /{" "}
                  {readable(incident.state)}
                </p>
              </div>
              {onNavigate && (
                <button
                  className={button}
                  onClick={() => onNavigate("incidents")}
                >
                  View incidents
                </button>
              )}
            </div>
            {analysis && (
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-700">
                {analysis.summary}
              </p>
            )}
            {!analysis && (
              <p role="status" className="mt-4 text-sm text-slate-500">
                Incident findings are not available yet. Monitoring continues.
              </p>
            )}
            {needsReview && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-slate-700">
                  Paused for administrator review. No automatic recovery will
                  run.
                </p>
                {currentUser.role !== "ADMIN" && (
                  <p className="text-xs text-slate-500">
                    Start a local demo session or sign in with review access to
                    record your decision.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {analysis?.recommended_runbook_id && (
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        currentUser.role !== "ADMIN" || !!pending || !!loadError
                      }
                      onClick={() => act("approve")}
                    >
                      <Check aria-hidden="true" className="h-4 w-4" />
                      {pending === "approve"
                        ? "Approving..."
                        : "Approve demo restart"}
                    </button>
                  )}
                  {!analysis?.recommended_runbook_id && (
                    <p className="py-2 text-sm text-slate-600">
                      No recovery action is approved for this fault. Review the
                      evidence and keep it escalated, or reset the
                      demonstration.
                    </p>
                  )}
                  <button
                    className={button}
                    disabled={
                      currentUser.role !== "ADMIN" || !!pending || !!loadError
                    }
                    onClick={() => act("reject")}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                    {pending === "reject" ? "Rejecting..." : "Keep escalated"}
                  </button>
                </div>
                {actionError && (
                  <p role="alert" className="text-sm text-rose-700">
                    {actionError}
                  </p>
                )}
              </div>
            )}
            {incident.state === "ESCALATED" && (
              <p className="mt-4 text-sm text-amber-800">
                Escalated for investigation. Recovery needs human attention.
              </p>
            )}
            {incident.state === "VERIFYING" && (
              <p role="status" className="mt-4 text-sm text-slate-700">
                Checking recovery:{" "}
                {Math.min(service?.consecutive_successes || 0, 2)} of 2
                successful health checks.
              </p>
            )}
          </div>
          <div className="border-t border-slate-200 px-5 py-4">
            <h3 className="text-xs font-medium text-slate-500">
              Recovery progress
            </h3>
            <ol className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {progress.map((step, index) => (
                <li key={step.label} className="text-xs">
                  <p className="flex items-center gap-2 text-slate-800">
                    {step.at ? (
                      <CheckCircle2
                        aria-hidden="true"
                        className="h-4 w-4 text-emerald-700"
                      />
                    ) : (
                      <span className="flex h-4 w-4 items-center justify-center text-slate-500">
                        {index + 1}
                      </span>
                    )}
                    {step.label}
                  </p>
                  <p className="mt-1 pl-6 text-slate-500">{time(step.at)}</p>
                </li>
              ))}
            </ol>
          </div>
          <details className="border-t border-slate-200 px-5 py-3">
            <summary className="cursor-pointer py-1 text-sm text-slate-700">
              Investigation details
            </summary>
            <div className="mt-4 space-y-4 pb-2 text-sm">
              {analysis && (
                <>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
                    <span>
                      Source:{" "}
                      {analysis.provider === "gemini_api"
                        ? "Gemini"
                        : analysis.provider === "enterprise_gemini"
                          ? "Enterprise Gemini"
                          : "Demo fallback"}
                    </span>
                    <span>Confidence: {analysis.confidence}</span>
                    <span>
                      {analysis.requires_human_review
                        ? "Human review required"
                        : "Subject to safety checks"}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-700">
                      Suspected cause
                    </h3>
                    <p className="mt-1 text-slate-500">
                      {analysis.suspected_cause}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-700">
                      Evidence and rationale
                    </h3>
                    <p className="mt-1 leading-relaxed text-slate-500">
                      {analysis.reasoning_summary}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-700">
                      Recommended action
                    </h3>
                    <p className="mt-1 text-slate-500">
                      {analysis.recommended_runbook_id ===
                      "RESTART_DEMO_CHILD_SERVICE"
                        ? "Restart demo service after safety checks"
                        : "Administrator investigation"}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-700">
                      Evidence references
                    </h3>
                    {analysis.evidence_event_ids.length ? (
                      <ul className="mt-1 space-y-1 font-mono text-xs text-slate-500">
                        {analysis.evidence_event_ids.map((id, index) => (
                          <li key={`${id}-${index}`} className="break-all">
                            {id}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-500">
                        No evidence references were supplied.
                      </p>
                    )}
                  </div>
                </>
              )}
              {incident.last_error && (
                <div>
                  <h3 className="font-medium text-slate-700">Observed error</h3>
                  <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-slate-500">
                    {incident.last_error}
                  </pre>
                </div>
              )}
              <p className="break-all font-mono text-xs text-slate-500">
                Incident: {incident.id} / {incident.fingerprint}
              </p>
            </div>
          </details>
        </section>
      ) : (
        <section className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <CheckCircle2
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-emerald-600"
          />
          <h2 className="font-medium text-slate-700">No active incidents</h2>
          <p className="text-xs text-slate-500">
            Monitoring continues. Service status is shown below.
          </p>
        </section>
      )}

      <MonitoringCharts
        observations={data.recent_observations || []}
        services={selectedService ? [selectedService] : []}
      />

      <div className="space-y-8">
        <section aria-labelledby="activity-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="activity-title"
              className="text-base font-semibold text-slate-800"
            >
              Recent activity
            </h2>
            {onNavigate && (
              <button
                className="min-h-11 text-sm text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
                onClick={() => onNavigate("audit")}
              >
                View audit trail
              </button>
            )}
          </div>
          <ol className="divide-y divide-stone-200 border-y border-stone-200">
            {recent_events.length === 0 && (
              <li className="py-5 text-sm text-slate-500">
                No events recorded yet.
              </li>
            )}
            {[...recent_events]
              .sort(
                (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
              )
              .slice(0, 5)
              .map((event) => (
                <li
                  key={event.id}
                  className="grid gap-2 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-5"
                >
                  <time
                    dateTime={event.at}
                    className="text-xs tabular-nums text-slate-500"
                  >
                    {time(event.at)}
                  </time>
                  <div>
                    <p className="text-sm leading-relaxed text-slate-700">
                      {event.public_message}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {readable(event.event_type)} /{" "}
                      {readable(event.actor_type)}
                    </p>
                  </div>
                </li>
              ))}
          </ol>
        </section>
        <details className="border-t border-stone-200 pt-3">
          <summary className="cursor-pointer py-3 text-sm font-medium text-stone-700">
            Service directory and workspace totals
          </summary>
          <div className="mt-4 space-y-6">
            {" "}
            <section aria-labelledby="services-title">
              <div className="mb-3 flex items-center justify-between">
                <h2
                  id="services-title"
                  className="text-base font-semibold text-slate-800"
                >
                  Services
                </h2>
                <span className="text-xs text-slate-500">
                  {services.length} monitored
                </span>
              </div>
              <div className="divide-y divide-stone-200 border-y border-stone-200">
                <div className="hidden grid-cols-[minmax(0,1fr)_6rem_8rem] gap-3 bg-slate-50/70 px-5 py-3 text-xs font-medium text-slate-500 sm:grid">
                  <span>Service</span>
                  <span>Status</span>
                  <span>Last check</span>
                </div>
                {services.length === 0 && (
                  <p className="p-5 text-sm text-slate-500">
                    No monitored services configured.
                  </p>
                )}
                {services.map((item) => (
                  <div key={item.id} className="p-4 sm:px-5">
                    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
                      <p className="text-sm font-medium text-slate-800">
                        {item.display_name}
                      </p>
                      <p
                        className={`flex items-center gap-2 text-xs ${item.status === "HEALTHY" ? "text-emerald-700" : "text-amber-800"}`}
                      >
                        {item.status === "HEALTHY" ? (
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                          />
                        ) : (
                          <AlertTriangle
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                          />
                        )}
                        {readable(item.status)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Checked {time(item.last_checked_at)}
                      </p>
                    </div>
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="inline-block cursor-pointer py-2">
                        Technical details
                      </summary>
                      <div className="mt-1 space-y-1">
                        <p className="break-all font-mono">
                          Health endpoint: {item.health_url}
                        </p>
                        <p>
                          Consecutive failed checks: {item.consecutive_failures}
                        </p>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </section>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                [
                  "Monitored Services",
                  metrics.monitored_services_count,
                  "Synthetic workloads",
                ],
                [
                  "Healthy services",
                  `${metrics.healthy_services_count} / ${metrics.monitored_services_count}`,
                  "Current service state",
                ],
                [
                  "Open incidents",
                  metrics.open_incidents_count,
                  "Unresolved incidents",
                ],
                [
                  "Average recovery time",
                  metrics.average_recovery_time_seconds == null
                    ? "Unavailable"
                    : `${Math.round(metrics.average_recovery_time_seconds)}s`,
                  `${metrics.total_recovered_count || 0} verified recoveries`,
                ],
              ].map(([label, value, note]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-stone-100 py-3"
                >
                  <dt className="text-xs font-medium text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-2 text-base font-semibold leading-none tabular-nums tracking-tight text-slate-900">
                    {value}
                  </dd>
                  <p className="mt-2 text-xs text-slate-500">{note}</p>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>
    </div>
  );
}
