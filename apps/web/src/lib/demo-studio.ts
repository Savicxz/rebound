import { DemoRun, DemoScenarioId, HealthObservation } from "../types";
import { utcTime } from "./demo-workflow";

export const studioScenarios = {
  crash: {
    title: "The learning portal goes offline",
    service: "Learning portal",
    action: "Open course materials",
    problem: "Class is starting, but students cannot reach their materials.",
    result:
      "One approved restart, then independent checks prove the portal is back.",
    lesson: "Detect an outage, recover once, and verify the result.",
  },
  degraded: {
    title: "Registration hits database contention",
    service: "Course registration",
    action: "Check registration access",
    problem: "Registration requests fail while the service is still running.",
    result:
      "Rebound collects the evidence and stops for human review. No blind restart.",
    lesson: "Knowing when not to act is part of reliable automation.",
  },
  attendance_backlog: {
    title: "Attendance records stop syncing",
    service: "Attendance sync",
    action: "Check attendance sync",
    problem:
      "Twelve synthetic attendance records are waiting in a stalled queue.",
    result:
      "Replay the bounded queue without restarting the process, then verify health.",
    lesson: "Recover a workflow without re-entering or duplicating attendance.",
  },
} as const;
export type StudioScenarioId = keyof typeof studioScenarios;
export const isStudioScenario = (
  value?: DemoScenarioId,
): value is StudioScenarioId => !!value && value in studioScenarios;
export interface StudentReceipt {
  checked_at: string;
  http_status: number | null;
  latency_ms: number;
  stage: "before" | "during" | "after";
  scenario_id: StudioScenarioId;
  response: {
    message?: string;
    status?: string;
    error_type?: string;
    queued_records?: number;
    attendance?: { pending: number; processed: number };
  };
}
export function receiptInRun(receipt: StudentReceipt, run?: DemoRun | null) {
  return (
    !!run &&
    receipt.scenario_id === run.scenario_id &&
    utcTime(receipt.checked_at) >= utcTime(run.injected_at) &&
    (!run.reset_at || utcTime(receipt.checked_at) <= utcTime(run.reset_at))
  );
}
export function observedStages(checks: HealthObservation[]) {
  const failure = checks.find((check) => !check.success);
  const after = failure
    ? checks
        .filter(
          (check) =>
            check.success &&
            utcTime(check.observed_at) > utcTime(failure.observed_at),
        )
        .at(-1)
    : undefined;
  return { failure, after };
}
