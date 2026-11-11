from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, Field, ConfigDict


# User & Auth
class UserBase(BaseModel):
    username: str
    role: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(UserBase):
    id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# Health Observation
class HealthObservationResponse(BaseModel):
    id: str
    service_id: str
    observed_at: datetime
    latency_ms: float
    http_status: Optional[int] = None
    success: bool
    error_type: Optional[str] = None
    sanitized_details: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# Service
class ServiceResponse(BaseModel):
    id: str
    slug: str
    display_name: str
    service_type: str
    is_demo: bool
    status: str
    health_url: str
    consecutive_failures: int
    consecutive_successes: int
    last_checked_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# Incident Event
class IncidentEventResponse(BaseModel):
    id: str
    incident_id: str
    sequence: int
    event_type: str
    actor_type: str
    actor_id: str
    at: datetime
    public_message: str
    metadata_json: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# AI Analysis Schema (Section 8 Normalized Contract)
class AIAnalysisResult(BaseModel):
    incident_id: str
    provider: Literal["gemini_api", "demo_fallback", "enterprise_gemini"]
    summary: str
    suspected_cause: str
    evidence_event_ids: List[str] = Field(default_factory=list)
    confidence: Literal["low", "medium", "high"]
    recommended_runbook_id: Optional[str] = None
    reasoning_summary: str
    requires_human_review: bool
    fallback_reason: Optional[str] = None


class AIAnalysisResponse(BaseModel):
    id: str
    incident_id: str
    provider: str
    schema_version: str
    result: AIAnalysisResult
    model_id: str
    error: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# Runbook Execution
class RunbookExecutionResponse(BaseModel):
    id: str
    incident_id: str
    runbook_id: str
    idempotency_key: str
    status: str
    approval_actor_id: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    runner_response_redacted: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# Incident
class IncidentResponse(BaseModel):
    id: str
    service_id: str
    fingerprint: str
    title: str
    severity: str
    state: str
    detected_at: datetime
    resolved_at: Optional[datetime] = None
    cause_code: Optional[str] = None
    last_error: Optional[str] = None
    auto_recovery_attempted: bool
    auto_recovery_cooldown_until: Optional[datetime] = None
    version: int
    events: List[IncidentEventResponse] = Field(default_factory=list)
    latest_analysis: Optional[AIAnalysisResult] = None
    runbook_executions: List[RunbookExecutionResponse] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


# Notification
class NotificationResponse(BaseModel):
    id: str
    incident_id: Optional[str] = None
    channel: str
    recipient_alias: str
    delivery_status: str
    message: str
    created_at: datetime
    delivered_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# Dashboard Summary
class DashboardMetrics(BaseModel):
    monitored_services_count: int
    healthy_services_count: int
    open_incidents_count: int
    total_recovered_count: int
    average_recovery_time_seconds: Optional[float] = None
    simulation_label: str
    gemini_status: Literal[
        "not_configured", "configured", "verified", "fallback", "enterprise_unavailable"
    ]
    last_analysis_provider: Optional[str] = None
    last_analysis_at: Optional[datetime] = None


class DashboardResponse(BaseModel):
    metrics: DashboardMetrics
    services: List[ServiceResponse]
    active_incident: Optional[IncidentResponse] = None
    recent_events: List[IncidentEventResponse] = Field(default_factory=list)
    recent_notifications: List[NotificationResponse] = Field(default_factory=list)
    recent_observations: List[HealthObservationResponse] = Field(default_factory=list)


# Demo Requests
class DemoFailureRequest(BaseModel):
    type: Literal[
        "crash",
        "degraded",
        "auth_outage",
        "storage_full",
        "attendance_backlog",
        "slow_assessment",
    ]


class RunbookActionRequest(BaseModel):
    runbook_id: str
    justification: Optional[str] = None
