"use client";

import React, { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Check, Pause, Printer } from "lucide-react";
import { DemoRun, HealthObservation, Incident } from "../types";
import { formatClock, utcTime } from "../lib/demo-workflow";
import {
  observedStages,
  receiptInRun,
  StudentReceipt,
} from "../lib/demo-studio";

export interface SummaryData {
  incident: Incident;
  run?: DemoRun | null;
  scenario: string;
  checks: HealthObservation[];
  receipts: StudentReceipt[];
  stale: boolean;
  actions?: React.ReactNode;
  runtime: {
    child_pid: number | null;
    child_running: boolean | null;
    observed_at: string;
    restart_count: number | null;
  } | null;
}
export const providerName = (incident: Incident) =>
  incident.latest_analysis?.provider === "demo_fallback"
    ? "Deterministic demo fallback (not a live Gemini call)"
    : incident.latest_analysis?.provider === "gemini_api"
      ? "Gemini API (recorded analysis)"
      : incident.latest_analysis?.provider === "enterprise_gemini"
        ? "Gemini Enterprise (recorded analysis)"
        : "No analysis provider recorded";
export function measuredRecovery(incident: Incident) {
  return incident.state === "RESOLVED" && incident.resolved_at
    ? Math.max(
        0,
        (utcTime(incident.resolved_at) - utcTime(incident.detected_at)) / 1000,
      ).toFixed(1) + " seconds"
    : "Not verified";
}
const measurement = (value?: {
  http_status?: number | null;
  latency_ms: number;
}) =>
  value
    ? `${value.http_status == null ? "No HTTP response" : `HTTP ${value.http_status}`} / ${value.latency_ms.toFixed(1)} ms`
    : "Not observed";

export function IncidentReport({
  report,
  generatedAt,
}: {
  report: SummaryData;
  generatedAt: string;
}) {
  const { incident, run, checks, receipts, scenario, stale, runtime } = report;
  const { failure, after } = observedStages(checks);
  const policy = incident.events.find(
    (event) => event.event_type === "POLICY_EVALUATED",
  );
  return (
    <article
      className="incident-report"
      aria-label="Printable incident summary"
    >
      <p className="ui-eyebrow">Rebound / incident evidence</p>
      <h1>{scenario}</h1>
      <p>
        <strong>Synthetic demonstration only.</strong> One isolated workload. No
        real school systems or student records are connected.
      </p>
      <dl className="report-facts">
        <div>
          <dt>Incident</dt>
          <dd>{incident.id}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            {run?.reset_at
              ? `Run reset / incident ${incident.state}`
              : incident.state}
          </dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>{formatClock(incident.detected_at)}</dd>
        </div>
        <div>
          <dt>Verified recovery time</dt>
          <dd>{measuredRecovery(incident)}</dd>
        </div>
      </dl>
      {stale && (
        <p>
          <strong>Evidence warning:</strong> One or more sources were stale or
          unavailable at export. This is a retained snapshot, not a claim of
          current availability.
        </p>
      )}
      <h2>Observed before / failure / after</h2>
      <table>
        <thead>
          <tr>
            <th>Observation</th>
            <th>Measured response</th>
            <th>Recorded time</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Healthy baseline</td>
            <td>{measurement(run?.baseline)}</td>
            <td>{formatClock(run?.baseline.observed_at)}</td>
          </tr>
          <tr>
            <td>Failed probe</td>
            <td>{measurement(failure)}</td>
            <td>{formatClock(failure?.observed_at)}</td>
          </tr>
          <tr>
            <td>Latest successful probe after failure</td>
            <td>{measurement(after)}</td>
            <td>{formatClock(after?.observed_at)}</td>
          </tr>
        </tbody>
      </table>
      <p>
        Before injection: PID {run?.runtime_before.child_pid ?? "not recorded"}.
        Latest supervisor observation:{" "}
        {runtime
          ? runtime.child_running
            ? `PID ${runtime.child_pid ?? "unknown"}`
            : "process stopped"
          : "not available"}
        , at {formatClock(runtime?.observed_at)}. Supervisor data may be newer
        than the incident.
      </p>
      <h2>Decision and bounded action</h2>
      <p>
        <strong>Analysis provider:</strong> {providerName(incident)}
      </p>
      <p>
        {incident.latest_analysis?.summary || "No analysis result recorded."}
      </p>
      <p>
        <strong>Policy:</strong>{" "}
        {policy?.public_message || "No policy verdict recorded."}
      </p>
      {incident.runbook_executions.length ? (
        incident.runbook_executions.map((execution) => (
          <p key={execution.id}>
            <strong>
              {execution.runbook_id} / {execution.status}
            </strong>
            <br />
            {execution.runner_response_redacted ||
              "No execution receipt recorded."}
            <br />
            Started {formatClock(execution.started_at)} / finished{" "}
            {formatClock(execution.finished_at)}
          </p>
        ))
      ) : (
        <p>
          No recovery execution recorded. Human-review and reset outcomes do not
          count as verified recovery.
        </p>
      )}
      <h2>Independent student requests</h2>
      {receipts.length ? (
        receipts.map((receipt, index) => (
          <p key={index}>
            {receipt.stage === "during" ? "After injection" : receipt.stage}:{" "}
            {measurement(receipt)} at {formatClock(receipt.checked_at)}
            {receipt.response.queued_records !== undefined
              ? ` / ${receipt.response.queued_records} records queued`
              : ""}
            {receipt.response.attendance
              ? ` / ${receipt.response.attendance.pending} pending, ${receipt.response.attendance.processed} processed`
              : ""}
          </p>
        ))
      ) : (
        <p>No independent request receipts captured for this run.</p>
      )}
      <h2>Recorded timeline</h2>
      <ol>
        {[...incident.events]
          .sort((a, b) => a.sequence - b.sequence)
          .map((event) => (
            <li key={event.id}>
              <strong>
                {formatClock(event.at)} / {event.event_type}
              </strong>
              <br />
              {event.public_message}
            </li>
          ))}
      </ol>
      <p className="report-footnote">
        Generated {formatClock(generatedAt)}. Probe history is a bounded sample.
        Missing observations are not inferred. Resolution requires independent
        verification; reset is administrative closure.
      </p>
    </article>
  );
}

export default function IncidentSummary(props: SummaryData) {
  const [snapshot, setSnapshot] = useState<{
    report: SummaryData;
    generatedAt: string;
  } | null>(null);
  const [printError, setPrintError] = useState(false);
  useEffect(() => {
    const clear = () => setSnapshot(null);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);
  const { incident, run, checks, receipts, runtime, stale } = props;
  const reset = !!run?.reset_at || incident.state === "CLOSED";
  const verified = incident.state === "RESOLVED" && !!incident.resolved_at;
  const review = ["AWAITING_APPROVAL", "ESCALATED"].includes(incident.state);
  const attempted =
    incident.auto_recovery_attempted || incident.runbook_executions.length > 0;
  const action = incident.runbook_executions[0];
  const runReceipts = receipts.filter(
    (receipt) =>
      receiptInRun(receipt, run) ||
      (run &&
        receipt.stage === "before" &&
        receipt.scenario_id === run.scenario_id &&
        utcTime(receipt.checked_at) <= utcTime(run.injected_at) &&
        utcTime(receipt.checked_at) >=
          utcTime(run.baseline.observed_at) - 20000),
  );
  const queued = runReceipts.find(
    (receipt) =>
      receipt.stage === "during" &&
      receipt.response.queued_records !== undefined,
  )?.response.queued_records;
  const attendance = [...runReceipts]
    .reverse()
    .find((receipt) => receipt.stage === "after" && receipt.http_status === 200)
    ?.response.attendance;
  function print() {
    setPrintError(false);
    try {
      flushSync(() =>
        setSnapshot({
          report: { ...props, receipts: runReceipts },
          generatedAt: new Date().toISOString(),
        }),
      );
      window.print();
    } catch {
      setPrintError(true);
    }
  }
  return (
    <section
      id="studio-outcome"
      className={`studio-outcome m-5 rounded-xl border border-stone-300 p-5 sm:m-6 ${review ? "border-dashed" : ""}`}
      aria-label="Run outcome"
    >
      <p className="ui-eyebrow">03 / What changed</p>
      <h3 className="mt-3 flex items-center gap-2 text-xl font-semibold">
        {verified && !reset ? (
          <Check aria-hidden="true" className="h-6 w-6" />
        ) : (
          <Pause aria-hidden="true" className="h-5 w-5" />
        )}
        {reset
          ? "Run reset. Evidence retained."
          : verified
            ? run?.scenario_id === "attendance_backlog"
              ? "Queue replayed. Recovery verified."
              : run?.scenario_id === "crash"
                ? "Portal restored. Recovery verified."
                : "Service recovery verified."
            : review
              ? attempted
                ? "Recovery needs human attention."
                : "Automatic recovery safely blocked"
              : "The result is still pending."}
      </h3>
      {run?.scenario_id === "attendance_backlog" && (
        <dl
          aria-label="Observed attendance result"
          className="mt-3 grid grid-cols-3 gap-3"
        >
          <div>
            <dt className="text-xs text-stone-600">Pending at failure</dt>
            <dd className="text-2xl font-semibold">
              {queued ?? "Not observed"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Processed afterward</dt>
            <dd className="text-2xl font-semibold">
              {attendance?.processed ?? "Not observed"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Remaining</dt>
            <dd className="text-2xl font-semibold">
              {attendance?.pending ?? "Not observed"}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-3 text-sm leading-relaxed text-stone-600">
        {reset
          ? "Reset is not verified recovery. The incident history remains available."
          : verified
            ? `Recovery took ${measuredRecovery(incident)} from incident detection. Independent probes confirmed the result.`
            : review
              ? attempted
                ? "A recovery action was attempted, but independent verification has not confirmed recovery. Review the recorded execution and incident evidence."
                : "Rebound detected the failure, preserved the evidence, and prevented an unapproved restart. Human investigation is required."
              : "An execution receipt alone does not prove recovery. Wait for the verification result."}
      </p>
      {action?.status === "SUCCESS" && !reset && (
        <p className="mt-3 text-sm font-medium text-stone-800">
          {action.runbook_id === "REPLAY_DEMO_ATTENDANCE_QUEUE"
            ? "Approved action completed: replay the synthetic attendance queue."
            : "Approved action completed: restart the isolated service."}
        </p>
      )}
      <p className="mt-2 text-xs text-stone-500">{providerName(incident)}</p>
      <details className="mt-3 border-t border-stone-200 pt-2">
        <summary className="text-sm text-stone-600">
          Recovery execution details
        </summary>
        <p className="mt-4 text-xs leading-relaxed text-stone-500">
          {action
            ? `${action.runbook_id}: ${action.status}. ${action.runner_response_redacted || ""}`
            : "No recovery action recorded."}
        </p>
        {run && (
          <p className="mt-2 text-xs text-stone-500">
            PID before: {run.runtime_before.child_pid ?? "not recorded"} /
            latest observed:{" "}
            {runtime?.child_pid ??
              (runtime && !runtime.child_running
                ? "stopped"
                : "not available")}{" "}
            {stale ? "/ evidence may be stale" : ""}
          </p>
        )}
        {review && !attempted && (
          <p className="mt-3 text-sm text-stone-600">
            <strong>Policy decision:</strong>{" "}
            {incident.events.find(
              (event) => event.event_type === "POLICY_EVALUATED",
            )?.public_message || "No policy verdict recorded."}
          </p>
        )}
      </details>
      <p className="mt-3 text-sm text-stone-600">
        {verified && !reset
          ? run?.scenario_id === "attendance_backlog"
            ? "Check the attendance response for pending and processed counts. Health verification is separate from that request."
            : "Operational value: service access restored with a bounded action and independently checked evidence."
          : review
            ? "Operational value: an uncertain fault stays under human control; no recovery is assumed."
            : "Evidence remains available for investigation."}
      </p>
      <div className="mt-4">{props.actions}</div>
      <button className="ui-button mt-3" onClick={print}>
        <Printer aria-hidden="true" className="h-4 w-4" />
        Print incident summary
      </button>
      {printError && (
        <p role="alert" className="mt-2 text-sm">
          Printing could not be opened. Retry or use the JSON export.
        </p>
      )}
      {snapshot &&
        createPortal(
          <div className="incident-print">
            <IncidentReport {...snapshot} />
          </div>,
          document.body,
        )}
    </section>
  );
}
