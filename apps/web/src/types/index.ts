export type ServiceStatus = "HEALTHY" | "SUSPECTED" | "DEGRADED" | "DOWN";
export type IncidentState =
  | "SUSPECTED"
  | "OPEN"
  | "ANALYZING"
  | "ACTION_RECOMMENDED"
  | "AWAITING_APPROVAL"
  | "RECOVERING"
  | "VERIFYING"
  | "RESOLVED"
  | "ESCALATED"
  | "CLOSED";

export interface Service {
  id: string;
  slug: string;
  display_name: string;
  service_type: string;
  is_demo: boolean;
  status: ServiceStatus;
  health_url: string;
  consecutive_failures: number;
  consecutive_successes: number;
  last_checked_at: string | null;
  created_at: string;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  sequence: number;
  event_type: string;
  actor_type: "SYSTEM" | "AI" | "OPERATOR" | "ADMIN";
  actor_id: string;
  at: string;
  public_message: string;
  metadata_json?: string | null;
}

export interface AIAnalysisResult {
  incident_id: string;
  provider: "gemini_api" | "demo_fallback" | "enterprise_gemini";
  summary: string;
  suspected_cause: string;
  evidence_event_ids: string[];
  confidence: "low" | "medium" | "high";
  recommended_runbook_id?: string | null;
  reasoning_summary: string;
  requires_human_review: boolean;
  fallback_reason?: string | null;
}

export interface RunbookExecution {
  id: string;
  incident_id: string;
  runbook_id: string;
  idempotency_key: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  approval_actor_id?: string | null;
  started_at: string;
  finished_at?: string | null;
  runner_response_redacted?: string | null;
}

export interface Incident {
  id: string;
  service_id: string;
  fingerprint: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  state: IncidentState;
  detected_at: string;
  resolved_at?: string | null;
  cause_code?: string | null;
  last_error?: string | null;
  auto_recovery_attempted: boolean;
  auto_recovery_cooldown_until?: string | null;
  version: number;
  events: IncidentEvent[];
  latest_analysis?: AIAnalysisResult | null;
  runbook_executions: RunbookExecution[];
}

export interface NotificationItem {
  id: string;
  incident_id?: string | null;
  channel: string;
  recipient_alias: string;
  delivery_status: string;
  message: string;
  created_at: string;
  delivered_at?: string | null;
}

export interface DashboardMetrics {
  monitored_services_count: number;
  healthy_services_count: number;
  open_incidents_count: number;
  total_recovered_count: number;
  average_recovery_time_seconds?: number | null;
  simulation_label: string;
  gemini_status:
    | "not_configured"
    | "configured"
    | "verified"
    | "fallback"
    | "enterprise_unavailable";
  last_analysis_provider?: string | null;
  last_analysis_at?: string | null;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  services: Service[];
  active_incident?: Incident | null;
  recent_events: IncidentEvent[];
  recent_notifications: NotificationItem[];
  recent_observations?: HealthObservation[];
}

export interface HealthObservation {
  id: string;
  service_id: string;
  observed_at: string;
  latency_ms: number;
  http_status?: number | null;
  success: boolean;
  error_type?: string | null;
  sanitized_details?: string | null;
}

export interface User {
  id: string;
  username: string;
  role: "OPERATOR" | "ADMIN";
}
