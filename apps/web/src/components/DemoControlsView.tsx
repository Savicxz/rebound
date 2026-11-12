"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RotateCcw, ShieldCheck } from "lucide-react";
import { DashboardData, DemoScenarioId, Incident } from "../types";
import DemoEvidence from "./DemoEvidence";
import StudentServicePanel from "./StudentServicePanel";
import ActivityIndicator from "./ActivityIndicator";
import { measuredRecovery } from "./IncidentSummary";
import { utcTime } from "../lib/demo-workflow";
import {
  isStudioScenario,
  StudentReceipt,
  StudioScenarioId,
  studioScenarios,
} from "../lib/demo-studio";

type Action = "inject" | "reset" | "replay";
interface Scenario {
  id: DemoScenarioId;
  title: string;
  fault: string;
  outcome: string;
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
  const [catalog, setCatalog] = useState<Scenario[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<StudioScenarioId>("crash");
  const [choosing, setChoosing] = useState(false);
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const [operation, setOperation] = useState<"inject" | "reset" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [failedAction, setFailedAction] = useState<Action>("inject");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<StudentReceipt[]>([]);
  const [observedIncident, setObservedIncident] = useState<Incident | null>(
    null,
  );
  const afterCaptured = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const run = data?.demo_run;
  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(false);
    fetch("/api/v1/demo/scenarios", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Scenario catalog unavailable");
        const items: Scenario[] = await response.json();
        if (!controller.signal.aborted) setCatalog(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (isStudioScenario(run?.scenario_id)) setSelected(run.scenario_id);
  }, [run?.id, run?.scenario_id]);
  const active = data?.active_incident;
  const inProgress = !!run && !run.reset_at && (!run.incident_id || !!active);
  const hasRun = !!run && !run.reset_at;
  const currentScenario =
    hasRun && isStudioScenario(run?.scenario_id) ? run.scenario_id : selected;
  const unsupported = hasRun && !isStudioScenario(run?.scenario_id);
  const service =
    data?.services.find((item) => item.slug === "demo-service") ||
    data?.services[0];
  const monitorStale =
    !!data &&
    (!service?.last_checked_at ||
      Date.now() - utcTime(service.last_checked_at) >
        Math.max(15000, (run?.check_interval_seconds || 5) * 3000));
  const unavailable = dataStale
    ? "Updates are unavailable. Refresh service data before changing the sandbox."
    : !data
      ? "Waiting for service data."
      : !currentUser.token
        ? "Start a demo session or sign in above to enable controls."
        : null;
  const reason =
    unavailable ||
    (active || inProgress
      ? "A run is active. Watch the live evidence below; reset to start again."
      : service?.status !== "HEALTHY"
        ? "Waiting for the monitor to detect the fault or confirm a healthy baseline."
        : monitorStale
          ? "The monitor has not reported recently. Wait for a fresh health check."
          : catalogLoading
            ? "Loading failure scenarios..."
            : catalogError
              ? "The scenario catalog could not be loaded."
              : !catalog.some((item) => item.id === selected)
                ? "This scenario is not available."
                : null);
  const info = studioScenarios[selected];
  const selectedCatalog = catalog.find((item) => item.id === selected);
  const ready = !reason && !operation;
  const confirm = (action: Action) => {
    setConfirmation(action);
    dialog.current?.showModal();
  };
  const observe = useCallback(
    (incident: Incident | null) => setObservedIncident(incident),
    [],
  );
  const capture = useCallback(
    async (
      stage: StudentReceipt["stage"],
      scenario: StudioScenarioId = selected,
    ) => {
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
            "Rebound could not reach the request API. Reconnect and retry.",
          );
        const result: StudentReceipt = {
          ...(await response.json()),
          stage,
          scenario_id: scenario,
        };
        setReceipts((previous) => [...previous, result].slice(-8));
        return result;
      } catch (error) {
        setRequestError(
          error instanceof Error
            ? error.message
            : "The request could not be observed.",
        );
        throw error;
      } finally {
        setRequestBusy(false);
      }
    },
    [currentUser.token, selected],
  );
  useEffect(() => {
    if (
      observedIncident?.state === "RESOLVED" &&
      run?.incident_id === observedIncident.id &&
      !run.reset_at &&
      currentUser.token &&
      afterCaptured.current !== run.id
    ) {
      afterCaptured.current = run.id;
      void capture(
        "after",
        isStudioScenario(run.scenario_id) ? run.scenario_id : selected,
      ).catch(() => {});
    }
  }, [
    observedIncident?.id,
    observedIncident?.state,
    run?.id,
    run?.incident_id,
    run?.reset_at,
    currentUser.token,
    capture,
  ]);
  async function execute() {
    if (
      !confirmation ||
      operation ||
      unavailable ||
      (confirmation === "inject" && !ready)
    )
      return;
    const action = confirmation;
    setFailed(false);
    setFeedback(null);
    setFailedAction(action);
    try {
      if (action === "reset" || action === "replay") {
        setOperation("reset");
        await onResetDemo();
        setReceipts([]);
        setRequestError(null);
        setObservedIncident(null);
        afterCaptured.current = null;
        if (action === "reset") {
          setChoosing(true);
          setFeedback(
            "Sandbox reset. Prior evidence was retained; reset is not verified recovery.",
          );
          dialog.current?.close();
          return;
        }
      }
      setOperation("inject");
      setReceipts([]);
      afterCaptured.current = null;
      await capture("before");
      await onTriggerFailure(selected);
      setChoosing(false);
      setFeedback(
        "Fault injection accepted. The student request and independent monitor now observe the same isolated workload.",
      );
      dialog.current?.close();
      document.getElementById("studio-workspace")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
      await capture("during").catch(() => {});
    } catch (error) {
      setFailed(true);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Action could not be confirmed. Refresh the evidence before retrying.",
      );
      dialog.current?.close();
    } finally {
      setOperation(null);
    }
  }
  const terminal =
    hasRun &&
    observedIncident &&
    ["RESOLVED", "AWAITING_APPROVAL", "ESCALATED", "CLOSED"].includes(
      observedIncident.state,
    );
  return (
    <div className="demo-studio space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="ui-eyebrow">A guided, real-request demonstration</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Demo Studio
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-stone-600">
            When a school service fails, can automation help without making it
            worse? Try the student service, introduce a fault, and follow
            Rebound's measured response.
          </p>
        </div>
        <span className="state-tag">
          Synthetic workload / no real school connection
        </span>
      </header>
      {(!hasRun || choosing) && (
        <details
          open={choosing}
          className="ui-panel p-4 sm:p-5"
          aria-label="Curated demonstrations"
        >
          <summary className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">
              Choose a different story / three curated scenarios
            </span>
            <span className="text-xs text-stone-500">
              Start with the learning portal
            </span>
          </summary>
          {catalogError ? (
            <div
              role="alert"
              className="ui-notice flex items-center justify-between gap-3"
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
                <div key={n} className="skeleton h-24" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(studioScenarios) as StudioScenarioId[]).map(
                (id) => (
                  <button
                    key={id}
                    className="scenario-card"
                    aria-pressed={selected === id}
                    disabled={!!operation || !!inProgress}
                    onClick={() => setSelected(id)}
                  >
                    <span className="flex w-full items-center justify-between text-xs text-stone-500">
                      {id === "crash"
                        ? "01 / Recommended"
                        : id === "degraded"
                          ? "02 / Human judgement"
                          : "03 / Workflow recovery"}
                      {selected === id && (
                        <Check className="h-4 w-4" aria-label="Selected" />
                      )}
                    </span>
                    <span className="text-sm font-semibold">
                      {studioScenarios[id].title}
                    </span>
                    <span className="text-xs text-stone-500">
                      {studioScenarios[id].lesson}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </details>
      )}
      <section
        className="studio-control flex flex-col justify-between gap-4 rounded-xl border border-stone-300 bg-white p-4 sm:flex-row sm:items-center sm:p-5"
        aria-label="Demonstration controls"
      >
        <div className="min-w-0">
          <p className="ui-eyebrow">
            {hasRun ? "Current demonstration" : "Ready to introduce a failure?"}
          </p>
          <h2 className="mt-1 text-base font-semibold">
            {unsupported
              ? "Existing sandbox run"
              : studioScenarios[currentScenario].title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            {terminal && observedIncident
              ? observedIncident.state === "RESOLVED"
                ? `Verified recovery: ${measuredRecovery(observedIncident)} from incident detection.`
                : "Automatic recovery stopped for human review. No verified recovery is claimed."
              : reason || `Expected: ${info.result}`}
          </p>
          {terminal && (
            <a
              href="#studio-outcome"
              className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
            >
              View result and print summary
            </a>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!hasRun ? (
            <button
              className="ui-button ui-button-primary"
              disabled={!ready}
              onClick={() => confirm("inject")}
            >
              {operation ? (
                <>
                  <ActivityIndicator className="!h-4 !w-4" />
                  Working...
                </>
              ) : (
                <>
                  Run demonstration
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>
          ) : (
            <>
              <button
                className="ui-button"
                disabled={!!operation || !!unavailable}
                onClick={() => confirm("reset")}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset sandbox
              </button>
              {terminal && (
                <button
                  className="ui-button ui-button-primary"
                  disabled={!!operation || !!unavailable || unsupported}
                  onClick={() => confirm("replay")}
                >
                  {choosing ? "Run selected demo" : "Replay this demo"}
                </button>
              )}
              <button
                className="ui-button"
                disabled={!!operation || !!inProgress}
                onClick={() => setChoosing((value) => !value)}
              >
                {choosing ? "Hide choices" : "Choose another demo"}
              </button>
            </>
          )}
        </div>
      </section>
      {feedback && (!terminal || failed) && (
        <p role={failed ? "alert" : "status"} className="ui-notice">
          {feedback}
          {failed && (
            <button
              className="ui-button ml-3"
              disabled={!!operation || !!unavailable}
              onClick={() => confirm(failedAction)}
            >
              Review and retry
            </button>
          )}
        </p>
      )}
      {hasRun && !terminal && (
        <p className="text-xs text-stone-500">
          Next:{" "}
          {unsupported
            ? "Reset this existing run to start a curated story."
            : terminal
              ? "Compare the result, print the incident summary, then replay or try another story."
              : "Watch the student request on the left and the independent monitoring evidence on the right."}
        </p>
      )}
      <div
        id="studio-workspace"
        className="studio-workspace grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)]"
      >
        <div className="min-w-0 lg:sticky lg:top-24">
          <StudentServicePanel
            scenario={currentScenario}
            receipts={receipts}
            busy={requestBusy}
            error={requestError}
            disabled={!!unavailable || !!operation || !!unsupported}
            onRequest={() => {
              void capture(
                terminal ? "after" : hasRun ? "during" : "before",
                currentScenario,
              ).catch(() => {});
            }}
          />
        </div>
        <div className="min-w-0">
          <DemoEvidence
            data={data}
            token={currentUser.token}
            operation={operation}
            dataStale={dataStale}
            scenarioTitle={
              run && !isStudioScenario(run.scenario_id)
                ? catalog.find((item) => item.id === run.scenario_id)?.title ||
                  run.scenario_id.replaceAll("_", " ")
                : studioScenarios[
                    run && isStudioScenario(run.scenario_id)
                      ? run.scenario_id
                      : currentScenario
                  ].title
            }
            compact
            outcomeActions={
              terminal ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="ui-button"
                    disabled={!!operation || !!unavailable || unsupported}
                    onClick={() => {
                      setSelected(currentScenario);
                      confirm("replay");
                    }}
                  >
                    Replay this scenario
                  </button>
                  <button
                    className="ui-button"
                    disabled={!!operation || !!unavailable}
                    onClick={() => {
                      setSelected(
                        currentScenario === "degraded" ? "crash" : "degraded",
                      );
                      confirm("replay");
                    }}
                  >
                    {currentScenario === "degraded"
                      ? "Try automatic recovery"
                      : "Try human-review scenario"}
                  </button>
                </div>
              ) : undefined
            }
            onIncidentChange={observe}
            studentReceipts={receipts}
          />
        </div>
      </div>
      <details className="border-t border-stone-200 pt-2">
        <summary className="text-sm text-stone-600">
          What this prototype demonstrates
        </summary>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-stone-600">
          {info.lesson} {selectedCatalog?.outcome} Student requests are separate
          from health probes. Only the predefined demo process and its synthetic
          queue can be changed. All timelines and recovery times come from
          recorded evidence; reset is administrative closure.
        </p>
        <p className="mt-3 flex items-center gap-2 text-xs text-stone-500">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          No real school infrastructure, student records, email delivery or
          production ticketing is connected.
        </p>
      </details>
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
              : confirmation === "replay"
                ? "Reset and replay"
                : "Introduce a controlled fault"}
          </p>
          <h2 id="confirm-demo-title" className="mt-3 text-xl font-semibold">
            {confirmation === "reset" ? "Reset the sandbox?" : info.title}
          </h2>
          <p className="mt-3 text-sm text-stone-600">
            {confirmation === "reset"
              ? "Open incidents will be closed without claiming verified recovery. Prior incident evidence is retained."
              : selectedCatalog?.fault}
          </p>
          {confirmation === "replay" && (
            <p className="mt-3 text-sm text-stone-600">
              The current run is reset first. New baseline and failure requests
              will be captured for a separate run.
            </p>
          )}
          {confirmation !== "reset" && (
            <p className="mt-3 text-sm text-stone-600">
              Only synthetic systems are affected. A healthy baseline is checked
              before injection.
            </p>
          )}
          {operation && (
            <p role="status" className="mt-4 flex items-center gap-3 text-sm">
              <ActivityIndicator />
              {operation === "reset"
                ? "Resetting sandbox"
                : "Capturing requests and injecting fault"}
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
              !!operation ||
              !!unavailable ||
              (confirmation === "inject" && !ready)
            }
            onClick={execute}
          >
            {operation
              ? "Working..."
              : confirmation === "reset"
                ? "Confirm reset"
                : confirmation === "replay"
                  ? "Confirm replay"
                  : "Confirm scenario"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
