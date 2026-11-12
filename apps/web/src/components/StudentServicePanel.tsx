"use client";

import React from "react";
import {
  BookOpen,
  GraduationCap,
  ArrowUpRight,
  WifiOff,
  Check,
} from "lucide-react";
import ActivityIndicator from "./ActivityIndicator";
import {
  StudentReceipt,
  StudioScenarioId,
  studioScenarios,
} from "../lib/demo-studio";
import { formatClock } from "../lib/demo-workflow";

export default function StudentServicePanel({
  scenario,
  receipts,
  busy,
  error,
  disabled,
  onRequest,
}: {
  scenario: StudioScenarioId;
  receipts: StudentReceipt[];
  busy: boolean;
  error: string | null;
  disabled: boolean;
  onRequest: () => void;
}) {
  const info = studioScenarios[scenario];
  const latest = receipts
    .filter((receipt) => receipt.scenario_id === scenario)
    .at(-1);
  const available = latest?.http_status === 200;
  const pending =
    latest?.response.queued_records ?? latest?.response.attendance?.pending;
  return (
    <section
      aria-labelledby="student-service-title"
      className="ui-panel studio-student overflow-hidden"
    >
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-5 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <GraduationCap aria-hidden="true" className="h-5 w-5" />
          Student services
        </span>
        <span className="state-tag">Simulated</span>
      </header>
      <div className="p-5 sm:p-6">
        <p className="ui-eyebrow">01 / What a student experiences</p>
        <h2
          id="student-service-title"
          className="mt-3 text-2xl font-semibold text-stone-900"
        >
          {info.service}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          {info.problem}
        </p>
        <div className="student-browser mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-stone-200 pb-3">
            <span className="text-xs text-stone-500">
              Demo student / sample workspace
            </span>
            <BookOpen aria-hidden="true" className="h-4 w-4 text-stone-500" />
          </div>
          <p className="text-base font-semibold text-stone-900">
            {scenario === "crash"
              ? "Course materials"
              : scenario === "degraded"
                ? "Your course registration"
                : "Today's attendance"}
          </p>
          <p className="mt-2 text-sm text-stone-500">
            {scenario === "crash"
              ? "Computer networks / Week 04"
              : scenario === "degraded"
                ? "Semester 1 / registration access"
                : "Synthetic records only / no student identities"}
          </p>
          <div
            role="status"
            aria-live="polite"
            className="my-5 min-h-28 rounded-lg border border-stone-200 bg-white p-4"
          >
            {busy ? (
              <div className="flex items-center gap-3 text-sm">
                <ActivityIndicator />
                Sending a real sandbox request
              </div>
            ) : error ? (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <WifiOff aria-hidden="true" className="h-4 w-4" />
                  Request could not be observed
                </p>
                <p className="mt-2 text-sm text-stone-600">{error}</p>
                <p className="mt-2 text-xs text-stone-500">
                  A Rebound connection error is not evidence that the school
                  service failed.
                </p>
              </>
            ) : !latest ? (
              <>
                <p className="font-medium">Not tested yet</p>
                <p className="mt-2 text-sm text-stone-500">
                  Use the button below, or start the demonstration to capture
                  baseline and failure requests.
                </p>
              </>
            ) : available ? (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <Check aria-hidden="true" className="h-4 w-4" />
                  Service request succeeded
                </p>
                <p className="mt-2 text-sm text-stone-600">
                  {scenario === "attendance_backlog" && pending !== undefined
                    ? `${pending} records pending / ${latest.response.attendance?.processed ?? "not recorded"} processed`
                    : scenario === "crash"
                      ? "Course materials are reachable. This preview is sample content; availability comes from the workload."
                      : "Registration access is available. No real enrolment was submitted."}
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <WifiOff aria-hidden="true" className="h-4 w-4" />
                  {scenario === "attendance_backlog"
                    ? "Attendance sync is blocked"
                    : scenario === "degraded"
                      ? "Registration is unavailable"
                      : "Course materials are unreachable"}
                </p>
                <p className="mt-2 text-sm text-stone-600">
                  {pending !== undefined
                    ? `${pending} synthetic records are queued.`
                    : latest.response.error_type ||
                      latest.response.message ||
                      "The isolated service did not respond."}
                </p>
              </>
            )}
          </div>
          <button
            className="ui-button ui-button-primary w-full"
            disabled={busy || disabled}
            onClick={onRequest}
          >
            {busy
              ? "Request in flight..."
              : error
                ? "Retry service request"
                : info.action}
            <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
          </button>
          {latest && (
            <p
              className="mt-3 font-mono text-xs leading-relaxed text-stone-600"
              data-testid="student-receipt"
            >
              {latest.http_status == null
                ? "No HTTP response"
                : `HTTP ${latest.http_status}`}{" "}
              / {latest.latency_ms} ms
              <br />
              Observed {formatClock(latest.checked_at)}
            </p>
          )}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-stone-500">
          Requests go through Rebound to its isolated child service. They do not
          advance health counters or resolve incidents.
        </p>
        {receipts.length > 0 && (
          <details className="mt-4 border-t border-stone-200 pt-2">
            <summary className="text-sm text-stone-600">
              Independent request receipts ({receipts.length})
            </summary>
            <ol className="mt-2 divide-y divide-stone-200">
              {receipts.map((receipt, index) => (
                <li
                  key={`${receipt.checked_at}-${index}`}
                  className="py-3 text-xs text-stone-600"
                >
                  <span className="font-medium capitalize">
                    {receipt.stage === "during"
                      ? "After injection"
                      : receipt.stage}
                  </span>{" "}
                  / {receipt.http_status ?? "No response"} /{" "}
                  {receipt.latency_ms} ms
                  <p className="mt-1 font-mono">
                    {formatClock(receipt.checked_at)}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </section>
  );
}
