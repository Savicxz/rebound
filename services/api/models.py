import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Boolean,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Text,
)
from sqlalchemy.orm import relationship
from services.api.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


def get_utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Service(Base):
    __tablename__ = "services"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    slug = Column(String(64), unique=True, nullable=False, index=True)
    display_name = Column(String(128), nullable=False)
    service_type = Column(String(64), nullable=False, default="web_service")
    is_demo = Column(Boolean, default=True, nullable=False)
    status = Column(
        String(32), default="HEALTHY", nullable=False
    )  # HEALTHY, SUSPECTED, DEGRADED, DOWN
    health_url = Column(String(256), nullable=False)
    consecutive_failures = Column(Integer, default=0, nullable=False)
    consecutive_successes = Column(Integer, default=0, nullable=False)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)

    observations = relationship(
        "HealthObservation", back_populates="service", cascade="all, delete-orphan"
    )
    incidents = relationship(
        "Incident", back_populates="service", cascade="all, delete-orphan"
    )


class HealthObservation(Base):
    __tablename__ = "health_observations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    service_id = Column(
        String(36),
        ForeignKey("services.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    observed_at = Column(
        DateTime(timezone=True), default=get_utc_now, nullable=False, index=True
    )
    latency_ms = Column(Float, nullable=False)
    http_status = Column(Integer, nullable=True)
    success = Column(Boolean, nullable=False)
    error_type = Column(String(64), nullable=True)
    sanitized_details = Column(String(1024), nullable=True)

    service = relationship("Service", back_populates="observations")


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    service_id = Column(
        String(36),
        ForeignKey("services.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fingerprint = Column(String(128), nullable=False, index=True)
    title = Column(String(256), nullable=False)
    severity = Column(
        String(32), default="HIGH", nullable=False
    )  # LOW, MEDIUM, HIGH, CRITICAL
    state = Column(String(32), default="OPEN", nullable=False, index=True)
    # States: SUSPECTED, OPEN, ANALYZING, ACTION_RECOMMENDED, AWAITING_APPROVAL, RECOVERING, VERIFYING, RESOLVED, ESCALATED, CLOSED
    detected_at = Column(
        DateTime(timezone=True), default=get_utc_now, nullable=False, index=True
    )
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    cause_code = Column(String(64), nullable=True)
    last_error = Column(String(1024), nullable=True)
    auto_recovery_attempted = Column(Boolean, default=False, nullable=False)
    auto_recovery_cooldown_until = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, default=1, nullable=False)

    service = relationship("Service", back_populates="incidents")
    events = relationship(
        "IncidentEvent",
        back_populates="incident",
        order_by="IncidentEvent.sequence",
        cascade="all, delete-orphan",
    )
    analyses = relationship(
        "AIAnalysis", back_populates="incident", cascade="all, delete-orphan"
    )
    runbook_executions = relationship(
        "RunbookExecution", back_populates="incident", cascade="all, delete-orphan"
    )
    notifications = relationship(
        "Notification", back_populates="incident", cascade="all, delete-orphan"
    )


class IncidentEvent(Base):
    __tablename__ = "incident_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    incident_id = Column(
        String(36),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence = Column(Integer, nullable=False)
    event_type = Column(String(64), nullable=False, index=True)
    actor_type = Column(
        String(32), default="SYSTEM", nullable=False
    )  # SYSTEM, AI, OPERATOR, ADMIN
    actor_id = Column(String(64), default="system", nullable=False)
    at = Column(
        DateTime(timezone=True), default=get_utc_now, nullable=False, index=True
    )
    public_message = Column(String(1024), nullable=False)
    metadata_json = Column(Text, nullable=True)

    incident = relationship("Incident", back_populates="events")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    incident_id = Column(
        String(36),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider = Column(
        String(32), nullable=False
    )  # gemini_api, demo_fallback, enterprise_gemini
    schema_version = Column(String(16), default="1.0", nullable=False)
    result_json = Column(Text, nullable=False)
    model_id = Column(String(64), nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)

    incident = relationship("Incident", back_populates="analyses")


class RunbookExecution(Base):
    __tablename__ = "runbook_executions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    incident_id = Column(
        String(36),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    runbook_id = Column(String(64), nullable=False)
    idempotency_key = Column(String(128), unique=True, nullable=False, index=True)
    status = Column(
        String(32), default="PENDING", nullable=False
    )  # PENDING, RUNNING, SUCCESS, FAILED
    approval_actor_id = Column(String(64), nullable=True)
    started_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    runner_response_redacted = Column(Text, nullable=True)

    incident = relationship("Incident", back_populates="runbook_executions")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    incident_id = Column(
        String(36),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    channel = Column(
        String(32), default="IN_APP", nullable=False
    )  # IN_APP, EMAIL_SIMULATED
    recipient_alias = Column(String(128), nullable=False)
    delivery_status = Column(
        String(32), default="DELIVERED", nullable=False
    )  # DELIVERED, PENDING, FAILED
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)
    delivered_at = Column(DateTime(timezone=True), nullable=True)

    incident = relationship("Incident", back_populates="notifications")


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(32), default="OPERATOR", nullable=False)  # OPERATOR, ADMIN
    created_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(64), primary_key=True)
    json_value = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)
    updated_by = Column(String(64), default="system", nullable=False)
