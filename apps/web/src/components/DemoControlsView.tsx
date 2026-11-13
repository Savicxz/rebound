"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { DashboardData, DemoScenarioId, Incident } from "../types";
import DemoEvidence from "./DemoEvidence";
import StudentServicePanel from "./StudentServicePanel";
import ActivityIndicator from "./ActivityIndicator";
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
  const [guidedPresentation, setGuidedPresentation] = useState(false);
  const [catalog, setCatalog] = useState<Scenario[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] =
    useState<StudioScenarioId>("attendance_backlog");
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
    if (run?.reset_at) setSelected("attendance_backlog");
    else if (isStudioScenario(run?.scenario_id)) setSelected(run.scenario_id);
  }, [run?.id, run?.scenario_id, run?.reset_at]);
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
          setGuidedPresentation(false);
          setFeedback(
            "Sandbox reset. Prior evidence was retained; reset is not verified recovery.",
          );
          dialog.current?.close();
          return;
        }
      }
      setGuidedPresentation(true);
      setOperation("inject");
      setReceipts([]);
      afterCaptured.current = null;
      await capture("before");
      await onTriggerFailure(selected);
      setFeedback(
        "Fault injection accepted. The student request and independent monitor now observe the same isolated workload.",
      );
      dialog.current?.close();
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Recover stalled services
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Rebound helps campus IT investigate failures, apply approved fixes,
            and verify recovery.
          </p>
        </div>
        <span className="state-tag">
          Synthetic data / no real university connection
        </span>
      </header>
      <section
        className="studio-control ui-panel flex flex-wrap items-end justify-between gap-4 p-4"
        aria-label="Demonstration controls"
      >
        <div>
          <label
            htmlFor="studio-scenario"
            className="block text-sm font-medium"
          >
            Change scenario
          </label>
          <select
            id="studio-scenario"
            className="ui-button mt-2 max-w-full bg-white"
            value={selected}
            disabled={
              !!operation ||
              (!!inProgress && !terminal) ||
              catalogLoading ||
              catalogError
            }
            onChange={(event) =>
              setSelected(event.target.value as StudioScenarioId)
            }
          >
            {(
              ["attendance_backlog", "degraded", "crash"] as StudioScenarioId[]
            ).map((id) => (
              <option key={id} value={id}>
                {studioScenarios[id].title}
              </option>
            ))}
          </select>
          {hasRun && selected !== currentScenario && !unsupported && (
            <p className="mt-2 text-xs text-stone-600">
              Result below: {studioScenarios[currentScenario].title}
            </p>
          )}
          {catalogLoading && (
            <p role="status" className="mt-2 text-xs">
              Loading scenarios...
            </p>
          )}
          {catalogError && (
            <p role="alert" className="mt-2 text-sm">
              Could not load scenarios.{" "}
              <button
                className="ui-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry catalog
              </button>
            </p>
          )}
          {reason && (unavailable || ((!hasRun || terminal) && !active)) && (
            <p className="mt-2 text-xs text-stone-600">{reason}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="ui-button ui-button-primary"
            disabled={
              !!operation ||
              !!unavailable ||
              (hasRun ? !terminal || unsupported : !ready)
            }
            onClick={() => confirm(hasRun ? "replay" : "inject")}
          >
            {operation ? (
              <>
                <ActivityIndicator className="!h-4 !w-4" /> Working...
              </>
            ) : hasRun && !terminal ? (
              "Recovery in progress"
            ) : terminal ? (
              selected === currentScenario ? (
                "Replay demo"
              ) : (
                "Run selected scenario"
              )
            ) : (
              "Run demonstration"
            )}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {hasRun && (
            <button
              className="ui-button"
              disabled={!!operation || !!unavailable}
              onClick={() => confirm("reset")}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset sandbox
            </button>
          )}
        </div>
      </section>
      {feedback && (failed || feedback.startsWith("Sandbox reset")) && (
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
      {requestError && (
        <p role="alert" className="ui-notice">
          {requestError} No service outcome is inferred. Open Technical details
          to retry the request.
        </p>
      )}
      <div id="studio-workspace" className="studio-workspace">
        <DemoEvidence
          data={data}
          token={currentUser.token}
          operation={operation}
          dataStale={dataStale}
          scenarioTitle={
            unsupported
              ? run?.scenario_id.replaceAll("_", " ")
              : studioScenarios[currentScenario].title
          }
          compact
          guidedPresentation={guidedPresentation}
          onIncidentChange={observe}
          studentReceipts={receipts}
          requestPanel={
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
          }
        />
      </div>
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
