"use client";

import React, { useState } from "react";
import { Cpu, Play, AlertCircle, RefreshCw, Shield, Info } from "lucide-react";
import { DashboardData } from "../types";
import DemoEvidence from "./DemoEvidence";

interface DemoControlsViewProps {
  data: DashboardData | null;
  currentUser: { username: string; role: string; token?: string };
  onTriggerFailure: (type: "crash" | "degraded") => Promise<void>;
  onResetDemo: () => Promise<void>;
}

export default function DemoControlsView({
  data,
  currentUser,
  onTriggerFailure,
  onResetDemo,
}: DemoControlsViewProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [pendingScenario, setPendingScenario] = useState<
    "crash" | "degraded" | null
  >(null);
  const [lastScenario, setLastScenario] = useState<"crash" | "degraded" | null>(
    null,
  );

  const activeIncident = data?.active_incident;
  const primaryService = data?.services[0];

  const handleAction = async (action: () => Promise<void>, name: string) => {
    setLoadingAction(name);
    setFeedback(null);
    setActionFailed(false);
    try {
      await action();
      setFeedback(
        `${name} completed. Watch the recorded service state below; fault injection does not mean recovery is complete.`,
      );
    } catch (err: unknown) {
      setActionFailed(true);
      setFeedback(
        `Failed to execute: ${err instanceof Error ? err.message : "Please try again."}`,
      );
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-blue-700" />
          Demonstration Control Center
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Trigger real-time sandbox fault scenarios to evaluate autonomous
          detection, AI diagnosis, and allowlisted recovery.
        </p>
      </div>

      <section
        className="rounded-xl border border-slate-200 bg-slate-50/60 p-5 space-y-4"
        aria-label="Demo walkthrough"
      >
        <h3 className="text-base font-semibold text-slate-900">
          Run a guided demonstration
        </h3>
        <ol className="grid gap-4 text-sm text-slate-700 md:grid-cols-3">
          <li>
            <span className="font-semibold text-stone-900">
              1. Start healthy
            </span>
            <p className="mt-1 text-slate-500">
              Reset the sandbox between scenarios and wait for a healthy
              service.
            </p>
          </li>
          <li>
            <span className="font-semibold text-stone-900">
              2. Choose a scenario
            </span>
            <p className="mt-1 text-slate-500">
              Scenario A demonstrates automatic recovery. Scenario B
              demonstrates a safety stop for human review.
            </p>
          </li>
          <li>
            <span className="font-semibold text-stone-900">
              3. Review the result
            </span>
            <p className="mt-1 text-slate-500">
              Use Overview to review actions, then open Incidents → Details for
              the recorded timeline and outcome.
            </p>
          </li>
        </ol>
        <div
          role="status"
          className="border-t border-slate-200 pt-3 text-sm text-slate-700"
        >
          {!data
            ? "Waiting for service data. Scenarios are unavailable until data loads."
            : activeIncident
              ? `Incident state: ${activeIncident.state.toLowerCase().replaceAll("_", " ")}. ${activeIncident.state === "AWAITING_APPROVAL" || activeIncident.state === "ESCALATED" ? "Automatic recovery is paused for human review." : "Follow the recorded progress below."}`
              : primaryService?.status === "HEALTHY"
                ? "Service is healthy. Ready to demonstrate a scenario."
                : "Service is not healthy. Waiting for the monitor to detect the fault; reset if this was unexpected."}
        </div>
        {lastScenario && (
          <p className="text-xs text-slate-500">
            Last scenario:{" "}
            {lastScenario === "crash"
              ? "A — service crash. Expected: detection, restart, then two successful health checks."
              : "B — degraded response. Expected: detection, findings and administrator review without automatic restart."}
          </p>
        )}
      </section>

      {pendingScenario && (
        <section
          role="group"
          aria-label="Confirm demo fault"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-3"
        >
          <h3 className="font-semibold text-amber-800">
            Start{" "}
            {pendingScenario === "crash"
              ? "Scenario A: service crash"
              : "Scenario B: degraded response"}
            ?
          </h3>
          <p className="text-sm text-slate-700">
            This deliberately interrupts the simulated service. No live systems
            are affected.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={
                loadingAction !== null ||
                !currentUser.token ||
                !data ||
                !!activeIncident ||
                primaryService?.status !== "HEALTHY"
              }
              onClick={() => {
                const scenario = pendingScenario;
                setPendingScenario(null);
                handleAction(
                  async () => {
                    await onTriggerFailure(scenario);
                    setLastScenario(scenario);
                  },
                  scenario === "crash"
                    ? "Simulate Crash"
                    : "Simulate Degraded Response",
                );
              }}
              className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirm scenario
            </button>
            <button
              onClick={() => setPendingScenario(null)}
              className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm text-slate-800"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <DemoEvidence data={data} token={currentUser.token} />

      {/* Scenario Execution Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Scenario A: Crash */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
              <Play className="w-4 h-4" /> Scenario A (Mandatory)
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Safe Auto-Recovery (Process Crash)
            </h3>
            <p className="text-xs text-slate-500">
              Terminates the supervised child process on port 5006. The health
              monitor detects 3 failed probes, requests Gemini analysis or the
              labelled demo fallback, verifies the deterministic allowlist, and
              commands the supervisor to restart the child.
            </p>
            <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-700">
              <strong>Expected result:</strong> After three failed checks, an
              incident opens. An approved restart runs, then two successful
              checks confirm recovery. Open incident details to see the measured
              recovery time.
            </p>
          </div>

          <div className="pt-2">
            <button
              disabled={
                loadingAction !== null ||
                !currentUser.token ||
                !data ||
                !!activeIncident ||
                primaryService?.status !== "HEALTHY"
              }
              onClick={() => setPendingScenario("crash")}
              className="w-full py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow transition-colors"
            >
              {loadingAction === "Simulate Crash" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Simulate Service Crash
            </button>
          </div>
        </div>

        {/* Scenario B: Degraded */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider">
              <AlertCircle className="w-4 h-4" /> Scenario B (Mandatory)
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Unsafe Failure & Escalation (HTTP 500)
            </h3>
            <p className="text-xs text-slate-500">
              Switches the child service to return internal HTTP 500 error
              responses (database deadlock). Because no auto-recovery runbook
              matches this fault class, the deterministic policy halts and
              escalates for human review.
            </p>
            <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-700">
              <strong>Expected result:</strong> After three failed checks,
              findings appear and the incident waits for administrator review.
              No automatic restart runs. Review it in Overview, or reset before
              the next demonstration.
            </p>
          </div>

          <div className="pt-2">
            <button
              disabled={
                loadingAction !== null ||
                !currentUser.token ||
                !data ||
                !!activeIncident ||
                primaryService?.status !== "HEALTHY"
              }
              onClick={() => setPendingScenario("degraded")}
              className="w-full py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow transition-colors"
            >
              {loadingAction === "Simulate Degraded Response" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              Simulate Degraded Fault
            </button>
          </div>
        </div>

        {/* Reset Demo */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-blue-700 font-bold text-xs uppercase tracking-wider">
              <RefreshCw className="w-4 h-4" /> Demo Environment Reset
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Restore Pristine Baseline
            </h3>
            <p className="text-xs text-slate-500">
              Restores the supervised child service to normal mode, resets
              consecutive failure and success probe counters, and
              administratively closes any active open incidents.
            </p>
          </div>

          <div className="pt-2">
            <button
              disabled={loadingAction !== null || !currentUser.token || !data}
              onClick={() => {
                setPendingScenario(null);
                handleAction(async () => {
                  await onResetDemo();
                  setLastScenario(null);
                }, "Reset Demo Environment");
              }}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {loadingAction === "Reset Demo Environment" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Reset Demo Sandbox
            </button>
          </div>
        </div>
      </div>

      {/* Action Execution Feedback */}
      {feedback && (
        <div
          role={actionFailed ? "alert" : "status"}
          className={`border rounded-lg p-3 text-sm flex items-center gap-2 ${actionFailed ? "bg-rose-500/10 border-rose-500/30 text-rose-700" : "bg-blue-500/10 border-blue-500/30 text-blue-700"}`}
        >
          <Info className="w-4 h-4 text-blue-700" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Judge & Security Guarantees Callout */}
      <div className="bg-slate-50/60 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-2">
        <div className="flex items-center gap-2 text-slate-700 font-semibold">
          <Shield className="w-4 h-4 text-blue-700" />
          <span>Sandbox execution boundaries</span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-slate-500 text-xs">
          <li>
            <strong>No Host Docker Socket:</strong> The runner is intended for
            private deployment and never needs a host Docker socket.
          </li>
          <li>
            <strong>Zero Arbitrary Code Execution:</strong> Runner only accepts
            predefined allowlisted runbook IDs (`RESTART_DEMO_CHILD_SERVICE`).
            LLM cannot supply shell scripts.
          </li>
          <li>
            <strong>Post-Recovery Verification:</strong> Incidents are never
            marked resolved until 2 consecutive real HTTP probes succeed.
          </li>
        </ul>
      </div>
    </div>
  );
}
