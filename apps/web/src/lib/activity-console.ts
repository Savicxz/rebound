import { Incident, IncidentEvent } from "../types";

export const PLAYBACK_INTERVAL_MS = 3000;
export type ActivityTone = "failure" | "review" | "success" | "neutral";
export interface ActivityRow {
  key: string;
  incidentId: string;
  eventId: string;
  sequence: number;
  at: string;
  title: string;
  detail: string;
  tone: ActivityTone;
  type: string;
}
export const friendlyAction = (value?: string | null) =>
  value === "REPLAY_DEMO_ATTENDANCE_QUEUE"
    ? "Replay the synthetic attendance queue"
    : value === "RESTART_DEMO_CHILD_SERVICE"
      ? "Restart the isolated service"
      : "Human investigation required";
export const readableEvidence = (value: string) =>
  value
    .replace(/^Policy verdict:\s*/, "")
    .replaceAll("REPLAY_DEMO_ATTENDANCE_QUEUE", "attendance queue replay")
    .replaceAll("RESTART_DEMO_CHILD_SERVICE", "service restart")
    .replaceAll("allowlisted runbook ", "approved action: ");

export function orderedEvents(events: IncidentEvent[], incidentId: string) {
  const ids = new Set<string>(),
    sequences = new Set<number>();
  return [...events]
    .filter(
      (event) =>
        event.incident_id === incidentId &&
        event.id &&
        Number.isInteger(event.sequence) &&
        event.sequence > 0,
    )
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .filter((event) => {
      if (ids.has(event.id) || sequences.has(event.sequence)) return false;
      ids.add(event.id);
      sequences.add(event.sequence);
      return true;
    });
}
export function hasHistoryGap(events: IncidentEvent[], incidentId: string) {
  const ordered = orderedEvents(events, incidentId);
  return ordered.some(
    (event, index) =>
      event.sequence !== (index ? ordered[index - 1].sequence + 1 : 1),
  );
}
export function activityRows(incident: Incident | null): ActivityRow[] {
  if (!incident) return [];
  return orderedEvents(incident.events, incident.id).flatMap((event) => {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(event.metadata_json || "{}") || {};
    } catch {
      /* Raw evidence stays available in Technical details. */
    }
    let title = "",
      detail = "",
      tone: ActivityTone = "neutral";
    switch (event.event_type) {
      case "INCIDENT_OPENED":
        title = "Failure detected";
        detail = "Repeated service checks failed.";
        tone = "failure";
        break;
      case "GEMINI_INVESTIGATION_STARTED":
        title = "Gemini investigation started";
        detail = event.public_message;
        break;
      case "DIAGNOSTIC_TOOL_REQUESTED":
        title = "Diagnostic tool requested";
        detail = event.public_message;
        break;
      case "DIAGNOSTIC_TOOL_COMPLETED":
        title = "Tool evidence received";
        detail = event.public_message;
        break;
      case "ANALYSIS_COMPLETED": {
        title =
          metadata.provider === "gemini_api"
            ? "Gemini assessment recorded"
            : "Evidence analyzed";
        const analysis =
          typeof metadata.summary === "string"
            ? metadata
            : incident.latest_analysis;
        detail = analysis
          ? `${analysis.summary} Recommended: ${friendlyAction(analysis.recommended_runbook_id as string | null)}.`
          : readableEvidence(event.public_message);
        break;
      }
      case "POLICY_EVALUATED":
        title = "Safety policy evaluated";
        detail = readableEvidence(event.public_message);
        tone = metadata.allowed === true ? "success" : "review";
        break;
      case "RECOVERY_STARTED":
        title = "Recovery started";
        detail = "The approved predefined action was started.";
        tone = "review";
        break;
      case "RECOVERY_ACTION_COMPLETED":
        title = "Recovery action completed";
        detail =
          "Execution completed; independent verification is still required.";
        break;
      case "VERIFICATION_PROBE_SUCCESS": {
        const number = event.public_message.match(
          /check (\d+)\/\d+ passed/i,
        )?.[1];
        title =
          number === "1"
            ? "First verification check"
            : number === "2"
              ? "Second verification check"
              : "Verification check recorded";
        detail = "An independent health check passed.";
        break;
      }
      case "INCIDENT_RESOLVED":
        title = "Recovery independently verified";
        detail = "Recorded healthy checks confirmed recovery.";
        tone = "success";
        break;
      case "HUMAN_REVIEW_REQUIRED":
        title = "Human investigation required";
        detail = incident.auto_recovery_attempted
          ? "Recovery was attempted but is not verified. Review the execution evidence."
          : "No automatic recovery was authorized.";
        tone = "review";
        break;
      case "RECOVERY_FAILED":
        title = "Recovery failed";
        detail =
          "An action was attempted. Human investigation is required; recovery is not verified.";
        tone = "failure";
        break;
      case "PROCESSING_INTERRUPTED":
        title = "Action completion unknown";
        detail =
          "Processing was interrupted. Do not assume recovery or retry automatically.";
        tone = "review";
        break;
      default:
        return [];
    }
    return [
      {
        key: `${incident.id}:${event.id}:${event.sequence}`,
        incidentId: incident.id,
        eventId: event.id,
        sequence: event.sequence,
        at: event.at,
        title,
        detail,
        tone,
        type: event.event_type,
      },
    ];
  });
}
export function mergeActivity(
  previous: ActivityRow[],
  incoming: ActivityRow[],
  incidentId: string,
) {
  const all = new Map(
    previous
      .filter((row) => row.incidentId === incidentId)
      .map((row) => [row.key, row]),
  );
  incoming.forEach((row) => all.set(row.key, row));
  const ids = new Set<string>(),
    sequences = new Set<number>();
  const merged = [...all.values()]
    .sort(
      (a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId),
    )
    .filter((row) => {
      if (ids.has(row.eventId) || sequences.has(row.sequence)) return false;
      ids.add(row.eventId);
      sequences.add(row.sequence);
      return true;
    });
  return JSON.stringify(previous) === JSON.stringify(merged)
    ? previous
    : merged;
}
