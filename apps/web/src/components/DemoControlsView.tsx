"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RotateCcw, ShieldCheck, Radio } from "lucide-react";
import { DashboardData, DemoScenarioId } from "../types";
import DemoEvidence from "./DemoEvidence";
import ActivityIndicator from "./ActivityIndicator";
import { formatClock, utcTime } from "../lib/demo-workflow";

interface Scenario {
  id: DemoScenarioId;
  title: string;
  workflow: string;
  impact: string;
  fault: string;
  outcome: string;
  transformation: string;
  runbook_id: string | null;
  owner?: string;
  signals?: { component: string; state: string }[];
}
interface Receipt {
  http_status: number | null;
  latency_ms: number;
  checked_at: string;
  response: {
    message?: string;
    error_type?: string;
    owner?: string;
    signals?: { component: string; state: string }[];
    attendance?: { pending: number; processed: number };
  };
}

export default function DemoControlsView({
  data,
  currentUser,
  onTriggerFailure,
  onResetDemo,
  dataStale = false,
}: {
  data: DashboardData | null;
  currentUser: { username: string; role: string; token?: string };
  onTriggerFailure: (type: DemoScenarioId) => Promise<void>;
  onResetDemo: () => Promise<void>;
  dataStale?: boolean;
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<DemoScenarioId>("crash");
  const [confirmation, setConfirmation] = useState<"inject" | "reset" | null>(
    null,
  );
  const [operation, setOperation] = useState<"inject" | "reset" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [failedAction, setFailedAction] = useState<"inject" | "reset">(
    "inject",
  );
  const [requestBusy, setRequestBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [receiptRun, setReceiptRun] = useState<string | undefined>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(false);
    fetch("/api/v1/demo/scenarios", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Scenario catalog unavailable");
        const catalog: Scenario[] = await response.json();
        if (!controller.signal.aborted) setScenarios(catalog);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [retry]);
  const active = data?.active_incident;
  const runInProgress =
    !!data?.demo_run &&
    !data.demo_run.reset_at &&
    (!data.demo_run.incident_id || !!active);
  const service =
    data?.services.find((item) => item.slug === "demo-service") ||
    data?.services[0];
  const selected =
    scenarios.find((item) => item.id === selectedId) || scenarios[0];
  const serviceStale =
    !!data &&
    (!service?.last_checked_at ||
      Date.now() - utcTime(service.last_checked_at) >
        Math.max(15000, (data.demo_run?.check_interval_seconds || 5) * 3000));
  const disabledReason = dataStale
    ? "Updates are unavailable. Refresh service data before changing the sandbox."
    : !data
      ? "Waiting for service data."
      : !currentUser.token
        ? "Start a demo session or sign in above to enable controls."
        : active || runInProgress
          ? "A run is already active. Follow its recorded progress below, or reset to start again."
          : service?.status !== "HEALTHY"
            ? "Waiting for the monitor to detect the fault or confirm a healthy baseline."
            : serviceStale
              ? "The monitor has not reported recently. Wait for a fresh check before starting a run."
              : catalogLoading
                ? "Loading failure scenarios..."
                : !selected
                  ? "Choose an available scenario."
                  : null;
  const ready = !disabledReason && !operation;
  const confirm = (action: "inject" | "reset") => {
    setConfirmation(action);
    dialog.current?.showModal();
  };
  async function execute() {
    if (
      !confirmation ||
      operation ||
      (confirmation === "inject" && (!ready || !selected))
    )
      return;
    const action = confirmation;
    setOperation(action);
    setFeedback(null);
    setFailed(false);
    try {
      if (action === "inject") await onTriggerFailure(selected!.id);
      else await onResetDemo();
      setReceipt(null);
      setFeedback(
        action === "inject"
          ? "Fault injection recorded. Follow the independent monitor evidence below."
          : "Sandbox reset. Open incidents were closed administratively; wait for a healthy baseline.",
      );
      dialog.current?.close();
    } catch (error) {
      setFailed(true);
      setFailedAction(action);
      setFeedback(
        error instanceof Error ? error.message : "Action failed. Try again.",
      );
      dialog.current?.close();
    } finally {
      setOperation(null);
    }
  }
  async function testWorkflow() {
    setRequestBusy(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/v1/demo/workflow-check", {
        method: "POST",
        headers: { Authorization: `Bearer ${currentUser.token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          "Could not run the synthetic request. Check your session and API connection, then retry.",
        );
      setReceipt(await response.json());
      setReceiptRun(data?.demo_run?.id);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Request failed",
      );
    } finally {
      setRequestBusy(false);
    }
  }
  const renderCard = (scenario: Scenario) => (
    <button
      key={scenario.id}
      className="scenario-card"
      aria-pressed={selected?.id === scenario.id}
      aria-label={`Select ${scenario.title}`}
      disabled={!!operation}
      onClick={() => setSelectedId(scenario.id)}
    >
      <span className="flex w-full items-center justify-between gap-2 text-[11px] text-stone-500">
        <span>
          {scenario.id === "crash"
            ? "01 / Recommended start"
            : scenario.runbook_id
              ? "Automatic recovery"
              : "Human investigation"}
        </span>
        {selected?.id === scenario.id && (
          <Check aria-label="Selected" className="h-4 w-4 text-stone-900" />
        )}
      </span>
      <span className="text-sm font-semibold leading-snug text-stone-900">
        {scenario.title}
      </span>
      <span className="mt-auto text-xs text-stone-500">
        {scenario.workflow}
      </span>
    </button>
  );
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="ui-eyebrow">Interactive sandbox / synthetic</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Failure, understood.
          </h1>
          <p className="mt-3 hidden max-w-2xl text-sm text-stone-500 sm:block">
            Select a school workflow. Introduce a controlled failure. Follow the
            evidence through to an independently verified recovery or a human
            review.
          </p>
        </div>
        <span className="state-tag hidden sm:inline-flex">
          <Radio aria-hidden="true" className="h-3 w-3" />
          Synthetic services only
        </span>
      </header>
      <section
        aria-label="Select and start a scenario"
        className="ui-panel overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 p-4 sm:items-center sm:p-6">
          <div className="min-w-0 flex-1">
            <p className="ui-eyebrow">01 / Select scenario</p>
            <h2 className="mt-2 text-sm font-semibold text-stone-900 sm:text-lg">
              {selected?.title || "Choose your first demonstration"}
            </h2>
            <p className="mt-1 hidden max-w-xl text-sm text-stone-500 sm:block">
              {selected?.runbook_id
                ? "One bounded recovery action, followed by independent verification."
                : selected
                  ? "Evidence-backed investigation. No automatic recovery for this fault."
                  : "The learning portal is the recommended starting point."}
            </p>
          </div>
          <button
            className="ui-button ui-button-primary shrink-0"
            disabled={!ready}
            onClick={() => confirm("inject")}
          >
            {operation === "inject" ? (
              <>
                <ActivityIndicator className="!h-4 !w-4" />
                Injecting fault
              </>
            ) : (
              <>
                <span className="sm:hidden">Run demo</span>
                <span className="hidden sm:inline">Run demonstration</span>
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
        {disabledReason && (
          <p
            role="status"
            className="border-b border-stone-200 px-5 py-3 text-xs text-stone-600 sm:px-6"
          >
            {disabledReason}
          </p>
        )}
        <div className="p-5 sm:p-6">
          {catalogError ? (
            <div
              role="alert"
              className="ui-notice flex flex-wrap items-center justify-between gap-3"
            >
              Could not load scenarios.
              <button
                className="ui-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry catalog
              </button>
            </div>
          ) : catalogLoading ? (
            <div
              aria-busy="true"
              aria-label="Loading scenario catalog"
              className="grid gap-3 sm:grid-cols-3"
            >
              {[1, 2, 3].map((n) => (
                <div key={n} className="skeleton h-28" />
              ))}
            </div>
          ) : (
            <>
              <div
                className="grid gap-3 sm:grid-cols-3"
                aria-label="Recommended scenarios"
              >
                {["crash", "attendance_backlog", "degraded"]
                  .map((id) => scenarios.find((item) => item.id === id))
                  .filter((item): item is Scenario => !!item)
                  .map(renderCard)}
              </div>
              <details className="mt-4">
                <summary className="text-sm text-stone-600">
                  Explore all {scenarios.length} scenarios, including network
                  and AV faults
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {scenarios
                    .filter(
                      (item) =>
                        !["crash", "attendance_backlog", "degraded"].includes(
                          item.id,
                        ),
                    )
                    .map(renderCard)}
                </div>
              </details>
            </>
          )}
          {selected && (
            <details className="mt-3 border-t border-stone-200 pt-2">
              <summary className="text-sm text-stone-600">
                Impact, expected result and sandbox boundaries
              </summary>
              <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
                {[
                  ["Potential school impact", selected.impact],
                  ["Fault actually injected", selected.fault],
                  ["Expected result", selected.outcome],
                  ["Workflow improvement", selected.transformation],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-medium text-stone-900">{label}</dt>
                    <dd className="mt-1 leading-relaxed text-stone-600">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.signals && (
                <div className="mt-5">
                  <p className="ui-eyebrow">
                    Modelled fault signals / not real equipment telemetry
                  </p>
                  <ol className="mt-3 flex flex-wrap gap-4">
                    {selected.signals.map((signal) => (
                      <li
                        key={signal.component}
                        className="border-l border-stone-300 pl-3 text-sm"
                      >
                        <p className="text-stone-500">{signal.component}</p>
                        <p className="text-stone-800">{signal.state}</p>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 text-xs text-stone-500">
                    Suggested team: {selected.owner}. No ticket or message is
                    sent.
                  </p>
                </div>
              )}
            </details>
          )}
        </div>
      </section>
      {feedback && (
        <div
          role={failed ? "alert" : "status"}
          className="ui-notice flex flex-wrap items-center justify-between gap-3"
        >
          <p>
            {failed ? "Action failed: " : ""}
            {feedback}
          </p>
          {failed && (
            <button
              className="ui-button"
              disabled={!!operation || dataStale}
              onClick={() => confirm(failedAction)}
            >
              Review and retry
            </button>
          )}
        </div>
      )}
      <DemoEvidence
        scenarioTitle={
          scenarios.find((item) => item.id === data?.demo_run?.scenario_id)
            ?.title
        }
        data={data}
        token={currentUser.token}
        operation={operation}
        dataStale={dataStale}
      />
      <section
        aria-label="Try the affected service"
        className="ui-panel p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="ui-eyebrow">Independent request</p>
            <h2 className="mt-2 text-lg font-semibold text-stone-900">
              Try the service yourself
            </h2>
            <p className="mt-2 max-w-xl text-sm text-stone-500">
              Send a synthetic request before or after recovery. This does not
              advance the monitor or change incident state.
            </p>
          </div>
          <button
            className="ui-button"
            disabled={!currentUser.token || requestBusy || dataStale}
            onClick={testWorkflow}
          >
            {requestBusy ? (
              <>
                <ActivityIndicator className="!h-4 !w-4" />
                Sending request
              </>
            ) : requestError ? (
              "Retry test request"
            ) : (
              "Send test request"
            )}
          </button>
        </div>
        {requestError && (
          <p role="alert" className="ui-notice mt-4">
            {requestError}
          </p>
        )}
        {receipt && (
          <div className="mt-5 border-t border-stone-200 pt-4 text-sm">
            <p className="font-mono text-xs text-stone-600">
              {receipt.http_status
                ? `HTTP ${receipt.http_status}`
                : "No response"}{" "}
              / {receipt.latency_ms} ms / {formatClock(receipt.checked_at)}
            </p>
            {receiptRun !== data?.demo_run?.id && (
              <p className="mt-2 text-xs text-stone-500">
                This receipt belongs to a previous run.
              </p>
            )}
            <p className="mt-2 text-stone-800">
              {receipt.response.error_type || receipt.response.message}
            </p>
            {receipt.response.signals?.length ? (
              <ol
                className="mt-4 flex flex-wrap gap-5"
                aria-label="Synthetic request signal path"
              >
                {receipt.response.signals.map((signal) => (
                  <li key={signal.component}>
                    <p className="text-xs text-stone-500">{signal.component}</p>
                    <p className="text-stone-800">{signal.state}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            {receipt.response.attendance && (
              <p className="mt-2 text-stone-600">
                {receipt.response.attendance.pending} attendance records pending
                / {receipt.response.attendance.processed} processed
              </p>
            )}
            {receipt.response.owner && (
              <p className="mt-3 text-xs text-stone-500">
                Suggested handoff: {receipt.response.owner}. No notification
                sent.
              </p>
            )}
          </div>
        )}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 pt-5">
        <p className="flex max-w-xl items-center gap-2 text-xs text-stone-500">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          One isolated workload; no school systems or student records are
          connected. A reset closes incidents without claiming recovery.
        </p>
        <button
          className="ui-button"
          disabled={!!operation || !currentUser.token || !data || dataStale}
          onClick={() => confirm("reset")}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {operation === "reset" ? "Resetting sandbox..." : "Reset sandbox"}
        </button>
      </footer>
      <dialog
        ref={dialog}
        onClose={() => setConfirmation(null)}
        onCancel={(event) => {
          if (operation) event.preventDefault();
        }}
        aria-labelledby="confirm-demo-title"
        className="ui-panel m-auto w-[calc(100%_-_2rem)] max-w-lg p-0 text-stone-900"
      >
        <div className="p-6">
          <p className="ui-eyebrow">
            {confirmation === "reset"
              ? "End this run"
              : "02 / Confirm injection"}
          </p>
          <h2 id="confirm-demo-title" className="mt-3 text-xl font-semibold">
            {confirmation === "reset" ? "Reset the sandbox?" : selected?.title}
          </h2>
          <p className="mt-3 text-sm text-stone-600">
            {confirmation === "reset"
              ? "The sandbox returns to normal and open incidents are administratively closed. Their evidence is retained, but closure is not verified recovery."
              : selected?.fault}
          </p>
          {confirmation === "inject" && (
            <p className="mt-3 text-sm text-stone-600">
              Only the synthetic workload is affected. A healthy baseline is
              checked before injection.
            </p>
          )}
          {operation && (
            <p role="status" className="mt-4 flex items-center gap-3 text-sm">
              <ActivityIndicator />
              {operation === "inject" ? "Injecting fault" : "Resetting sandbox"}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-stone-200 p-4">
          <button
            className="ui-button"
            disabled={!!operation}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            className="ui-button ui-button-primary"
            disabled={
              !!operation || dataStale || (confirmation === "inject" && !ready)
            }
            onClick={execute}
          >
            {operation
              ? "Working..."
              : confirmation === "reset"
                ? "Confirm reset"
                : "Confirm scenario"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
