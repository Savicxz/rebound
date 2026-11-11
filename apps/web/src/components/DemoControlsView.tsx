"use client";

import React, { useEffect, useState } from "react";
import { DashboardData, DemoScenarioId } from "../types";
import DemoEvidence from "./DemoEvidence";

interface Scenario {
  id: DemoScenarioId;
  title: string;
  workflow: string;
  impact: string;
  fault: string;
  outcome: string;
  transformation: string;
  runbook_id: string | null;
}

export default function DemoControlsView({
  data,
  currentUser,
  onTriggerFailure,
  onResetDemo,
}: {
  data: DashboardData | null;
  currentUser: { username: string; role: string; token?: string };
  onTriggerFailure: (type: DemoScenarioId) => Promise<void>;
  onResetDemo: () => Promise<void>;
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(false);
    fetch("/api/v1/demo/scenarios", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Scenario catalog unavailable");
        setScenarios(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError(true);
      });
    return () => controller.abort();
  }, [retry]);
  const active = data?.active_incident;
  const ready =
    !!currentUser.token &&
    !!data &&
    !active &&
    data.services[0]?.status === "HEALTHY";
  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setFeedback(null);
    setFailed(false);
    setConfirming(false);
    try {
      await action();
      setFeedback(message);
    } catch (error) {
      setFailed(true);
      setFeedback(
        error instanceof Error ? error.message : "Action failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">
            School service failure lab
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-stone-500">
            Explore how service operations affect everyday school workflows.
            These profiles share one isolated workload; no school systems or
            student records are connected.
          </p>
        </div>
        <button
          disabled={busy || !currentUser.token || !data}
          onClick={() =>
            run(
              onResetDemo,
              "Sandbox reset. Wait for a healthy probe before starting another scenario.",
            )
          }
          className="min-h-11 rounded-md border border-stone-300 px-4 text-sm text-stone-800 disabled:opacity-50"
        >
          Reset sandbox
        </button>
      </header>
      <p
        role="status"
        className="border-l-2 border-stone-400 pl-4 text-sm text-stone-700"
      >
        {!data
          ? "Waiting for service data."
          : active
            ? `Incident: ${active.state.toLowerCase().replaceAll("_", " ")}. ${["AWAITING_APPROVAL", "ESCALATED"].includes(active.state) ? "Automatic recovery is paused for human review." : "Follow the recorded evidence below."}`
            : data.services[0]?.status !== "HEALTHY"
              ? "Waiting for the monitor to detect the fault or confirm a healthy baseline."
              : !currentUser.token
                ? "Start a local demo session above to enable scenarios."
                : "Healthy baseline confirmed. Choose a workflow to investigate."}
      </p>
      <section
        aria-label="School failure scenarios"
        className="overflow-hidden rounded-md border border-stone-200 bg-white"
      >
        <div className="border-b border-stone-200 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-stone-500">
          Workflow / expected response
        </div>
        {catalogError ? (
          <div role="alert" className="p-5 text-sm text-rose-700">
            Could not load scenarios.{" "}
            <button
              className="underline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : !scenarios.length ? (
          <p className="p-5 text-sm text-stone-500">
            Loading failure scenarios…
          </p>
        ) : (
          scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className="border-b border-stone-200 last:border-0"
            >
              <button
                aria-expanded={selected?.id === scenario.id}
                onClick={() => {
                  setSelected(selected?.id === scenario.id ? null : scenario);
                  setConfirming(false);
                }}
                className="flex min-h-16 w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-stone-50"
              >
                <span className="text-sm font-medium text-stone-900">
                  {scenario.title}
                </span>
                <span
                  className={`text-xs ${scenario.runbook_id ? "text-emerald-700" : "text-amber-800"}`}
                >
                  {scenario.runbook_id
                    ? "Bounded automatic recovery"
                    : "Human investigation"}{" "}
                  · {selected?.id === scenario.id ? "−" : "+"}
                </span>
              </button>
              {selected?.id === scenario.id && (
                <div className="space-y-4 bg-stone-50 px-5 pb-5 pt-2">
                  <dl className="grid gap-4 text-sm md:grid-cols-2">
                    {[
                      ["Potential school impact", scenario.impact],
                      ["Fault actually injected", scenario.fault],
                      ["Expected result", scenario.outcome],
                      ["Workflow improvement", scenario.transformation],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="font-semibold text-stone-900">
                          {label}
                        </dt>
                        <dd className="mt-1 text-stone-600">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {confirming ? (
                    <div
                      role="group"
                      aria-label="Confirm demo fault"
                      className="flex flex-wrap items-center gap-3"
                    >
                      <p className="text-sm text-stone-700">
                        Interrupt this synthetic workload?
                      </p>
                      <button
                        disabled={busy || !ready}
                        onClick={() =>
                          run(
                            () => onTriggerFailure(scenario.id),
                            `${scenario.workflow} fault injected. Recovery is complete only after independent verification.`,
                          )
                        }
                        className="min-h-11 rounded-md bg-primary px-4 text-sm text-white disabled:opacity-50"
                      >
                        Confirm scenario
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        className="min-h-11 px-3 text-sm text-stone-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      disabled={busy || !ready}
                      onClick={() => setConfirming(true)}
                      className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Inject this fault
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </section>
      {feedback && (
        <p
          role={failed ? "alert" : "status"}
          className={`text-sm ${failed ? "text-rose-700" : "text-stone-700"}`}
        >
          {feedback}
        </p>
      )}
      <DemoEvidence data={data} token={currentUser.token} />
      <p className="text-xs leading-relaxed text-stone-500">
        Start healthy → inject one fault → inspect evidence → reset before the
        next scenario. Recovery uses two fixed actions: restart the demo process
        or replay its synthetic attendance queue. Unknown faults stop for human
        review. No Google Cloud IAM setup is required for this local demo.
      </p>
    </div>
  );
}
