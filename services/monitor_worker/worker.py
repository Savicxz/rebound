import asyncio
import time
import json
import logging
from datetime import timezone, timedelta
import httpx
from sqlalchemy.future import select

from services.api.config import settings
from services.api.database import AsyncSessionLocal
from services.api.models import (
    Service,
    HealthObservation,
    Incident,
    IncidentEvent,
    AIAnalysis,
    RunbookExecution,
    Notification,
    generate_uuid,
    get_utc_now,
)
from services.api.analyzer import get_analyzer, sanitize_logs
from services.api.policy import evaluate_incident_policy, execute_runbook
from services.api.events import broadcaster

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("rebound.monitor")


async def record_event(
    session,
    incident_id: str,
    event_type: str,
    message: str,
    actor_type: str = "SYSTEM",
    actor_id: str = "monitor_worker",
    metadata: dict = None,
) -> IncidentEvent:
    # Get current max sequence
    q = (
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.sequence.desc())
    )
    res = await session.execute(q)
    last_event = res.scalars().first()
    seq = (last_event.sequence + 1) if last_event else 1

    event = IncidentEvent(
        id=generate_uuid(),
        incident_id=incident_id,
        sequence=seq,
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        at=get_utc_now(),
        public_message=message,
        metadata_json=json.dumps(metadata, default=str) if metadata else None,
    )
    session.add(event)
    await session.flush()

    # Broadcast event
    await broadcaster.broadcast(
        "incident_event",
        {
            "incident_id": incident_id,
            "event_type": event_type,
            "message": message,
            "actor_type": actor_type,
            "sequence": seq,
            "timestamp": event.at.isoformat(),
        },
    )
    return event


async def create_notification(
    session, incident_id: str, message: str, channel: str = "IN_APP"
):
    notif = Notification(
        id=generate_uuid(),
        incident_id=incident_id,
        channel=channel,
        recipient_alias="operations-team@demo.internal",
        delivery_status="DELIVERED",
        message=message,
        created_at=get_utc_now(),
        delivered_at=get_utc_now(),
    )
    session.add(notif)
    await session.flush()
    await broadcaster.broadcast(
        "notification",
        {
            "id": notif.id,
            "incident_id": incident_id,
            "message": message,
            "channel": channel,
            "timestamp": notif.created_at.isoformat(),
        },
    )


async def probe_service(service: Service) -> dict:
    url = service.health_url
    start = time.perf_counter()
    status_code = None
    success = False
    error_type = None
    details = ""

    try:
        async with httpx.AsyncClient(
            timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS
        ) as client:
            resp = await client.get(url)
            latency = (time.perf_counter() - start) * 1000.0
            status_code = resp.status_code
            if status_code == 200:
                success = True
                details = resp.text[:200]
            else:
                success = False
                error_type = f"HTTP_{status_code}"
                details = resp.text[:400]
    except httpx.ConnectError as e:
        latency = (time.perf_counter() - start) * 1000.0
        success = False
        error_type = "CONNECTION_REFUSED"
        details = "Connection refused on target port; process is down"
    except httpx.TimeoutException as e:
        latency = (time.perf_counter() - start) * 1000.0
        success = False
        error_type = "TIMEOUT"
        details = f"Request timed out after {settings.HEALTH_CHECK_TIMEOUT_SECONDS}s"
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000.0
        success = False
        error_type = "PROBE_EXCEPTION"
        details = str(e)[:200]

    return {
        "service_id": service.id,
        "observed_at": get_utc_now(),
        "latency_ms": round(latency, 2),
        "http_status": status_code,
        "success": success,
        "error_type": error_type,
        "sanitized_details": sanitize_logs(details),
    }


async def handle_incident_flow(
    session, incident: Incident, service: Service, recent_probes: list
):
    """Executes the AI Analysis, Policy Decision, and Safe Recovery workflow."""
    logger.info(
        f"Initiating incident triage for incident {incident.id} ({incident.title})"
    )
    incident.state = "ANALYZING"
    await session.commit()
    await broadcaster.broadcast(
        "incident_state", {"incident_id": incident.id, "state": "ANALYZING"}
    )

    # 1. AI Analysis
    analyzer = get_analyzer()
    analysis_result = await analyzer.analyze(
        incident_id=incident.id,
        service_name=service.display_name,
        recent_probes=recent_probes,
        last_error=incident.last_error,
    )

    # Persist AI analysis
    ai_record = AIAnalysis(
        id=generate_uuid(),
        incident_id=incident.id,
        provider=analysis_result.provider,
        schema_version="1.0",
        result_json=analysis_result.model_dump_json(),
        model_id=getattr(analyzer, "model_id", "unknown")
        if analysis_result.provider == "gemini_api"
        else "deterministic_engine",
        error=analysis_result.fallback_reason,
        created_at=get_utc_now(),
    )
    session.add(ai_record)
    await record_event(
        session,
        incident.id,
        "ANALYSIS_COMPLETED",
        f"Incident analysis completed via {analysis_result.provider}. Suspected cause: {analysis_result.suspected_cause}.",
        actor_type="AI",
        actor_id=analysis_result.provider,
        metadata=analysis_result.model_dump(),
    )
    await session.commit()

    # 2. Deterministic Policy Evaluation
    policy_decision = evaluate_incident_policy(incident, service, analysis_result)
    logger.info(
        f"Policy decision for {incident.id}: allowed={policy_decision.allowed}, transition={policy_decision.state_transition}"
    )

    await record_event(
        session,
        incident.id,
        "POLICY_EVALUATED",
        f"Policy verdict: {policy_decision.reason}",
        actor_type="SYSTEM",
        actor_id="policy_engine",
        metadata={
            "allowed": policy_decision.allowed,
            "auto_recover": policy_decision.auto_recover,
            "runbook_id": policy_decision.runbook_id,
            "target_state": policy_decision.state_transition,
        },
    )

    # 3. Action execution or Escalation
    if policy_decision.auto_recover and policy_decision.runbook_id:
        incident.state = "RECOVERING"
        incident.auto_recovery_attempted = True
        incident.auto_recovery_cooldown_until = get_utc_now() + timedelta(
            seconds=settings.AUTO_RECOVERY_COOLDOWN_SECONDS
        )
        await session.commit()
        await broadcaster.broadcast(
            "incident_state", {"incident_id": incident.id, "state": "RECOVERING"}
        )

        idempotency_key = f"rec_{incident.id}_{int(time.time())}"
        runbook_exec = RunbookExecution(
            id=generate_uuid(),
            incident_id=incident.id,
            runbook_id=policy_decision.runbook_id,
            idempotency_key=idempotency_key,
            status="RUNNING",
            approval_actor_id="autonomous_policy",
            started_at=get_utc_now(),
        )
        session.add(runbook_exec)
        await session.commit()

        await record_event(
            session,
            incident.id,
            "RECOVERY_STARTED",
            f"Executing pre-approved allowlisted runbook: {policy_decision.runbook_id}",
            actor_type="SYSTEM",
            actor_id="runbook_executor",
        )

        success, msg = await execute_runbook(
            runbook_id=policy_decision.runbook_id,
            incident_id=incident.id,
            idempotency_key=idempotency_key,
        )

        runbook_exec.finished_at = get_utc_now()
        runbook_exec.runner_response_redacted = msg

        if success:
            runbook_exec.status = "SUCCESS"
            incident.state = "VERIFYING"
            service.consecutive_successes = 0  # reset verification counter
            await record_event(
                session,
                incident.id,
                "RECOVERY_ACTION_COMPLETED",
                f"Runner restart action completed. Transitioning to VERIFYING state (awaiting {settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE} healthy probes).",
                actor_type="SYSTEM",
                actor_id="runbook_executor",
                metadata={"runner_response": msg},
            )
        else:
            runbook_exec.status = "FAILED"
            incident.state = "ESCALATED"
            await record_event(
                session,
                incident.id,
                "RECOVERY_FAILED",
                f"Runbook execution failed: {msg}. Incident escalated to human operations.",
                actor_type="SYSTEM",
                actor_id="runbook_executor",
            )
            await create_notification(
                session,
                incident.id,
                f"Auto-recovery failed for {service.display_name}. Manual intervention required.",
            )
    else:
        # Scenario B: Human approval or escalation
        incident.state = policy_decision.state_transition
        await record_event(
            session,
            incident.id,
            "HUMAN_REVIEW_REQUIRED",
            f"Automated recovery declined: {policy_decision.reason}. Operator review required.",
            actor_type="SYSTEM",
            actor_id="policy_engine",
        )
        await create_notification(
            session,
            incident.id,
            f"Incident {incident.id} escalated: {policy_decision.reason}",
        )

    await session.commit()
    await broadcaster.broadcast(
        "incident_state", {"incident_id": incident.id, "state": incident.state}
    )


def ensure_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def monitor_iteration():
    """Single polling and state transition tick."""
    async with AsyncSessionLocal() as session:
        # Load all monitored services
        q = select(Service)
        res = await session.execute(q)
        services = res.scalars().all()

        for service in services:
            probe = await probe_service(service)
            obs = HealthObservation(
                id=generate_uuid(),
                service_id=service.id,
                observed_at=probe["observed_at"],
                latency_ms=probe["latency_ms"],
                http_status=probe["http_status"],
                success=probe["success"],
                error_type=probe["error_type"],
                sanitized_details=probe["sanitized_details"],
            )
            session.add(obs)
            service.last_checked_at = probe["observed_at"]

            # Query active incident for this service (state not in RESOLVED, CLOSED)
            inc_q = (
                select(Incident)
                .where(
                    Incident.service_id == service.id,
                    Incident.state.notin_(["RESOLVED", "CLOSED"]),
                )
                .order_by(Incident.detected_at.desc())
            )
            inc_res = await session.execute(inc_q)
            active_incident = inc_res.scalars().first()

            if not probe["success"]:
                # Failed probe
                service.consecutive_failures += 1
                service.consecutive_successes = 0

                if service.consecutive_failures < settings.CONSECUTIVE_FAILURES_TO_OPEN:
                    service.status = "SUSPECTED"
                    logger.info(
                        f"Service {service.slug} probe failed ({service.consecutive_failures}/{settings.CONSECUTIVE_FAILURES_TO_OPEN}). State: SUSPECTED"
                    )
                else:
                    # 3 or more consecutive failures
                    service.status = (
                        "DOWN"
                        if probe["error_type"] == "CONNECTION_REFUSED"
                        else "DEGRADED"
                    )

                    if not active_incident:
                        # Open exactly 1 new incident
                        fingerprint = (
                            f"{service.slug}_{probe['error_type'] or 'UNREACHABLE'}"
                        )
                        title = (
                            f"Outage detected on {service.display_name}"
                            if service.status == "DOWN"
                            else f"Degraded performance on {service.display_name}"
                        )
                        severity = "CRITICAL" if service.status == "DOWN" else "HIGH"

                        active_incident = Incident(
                            id=generate_uuid(),
                            service_id=service.id,
                            fingerprint=fingerprint,
                            title=title,
                            severity=severity,
                            state="OPEN",
                            detected_at=get_utc_now(),
                            cause_code=probe["error_type"],
                            last_error=probe["sanitized_details"],
                            auto_recovery_attempted=False,
                        )
                        session.add(active_incident)
                        await session.flush()

                        await record_event(
                            session,
                            active_incident.id,
                            "INCIDENT_OPENED",
                            f"Incident opened: {service.consecutive_failures} consecutive failed probes. Reason: {probe['error_type']}",
                            actor_type="SYSTEM",
                            actor_id="health_monitor",
                            metadata=probe,
                        )
                        await create_notification(
                            session,
                            active_incident.id,
                            f"ALERT: {active_incident.title} ({service.slug}). State: OPEN.",
                        )
                        await session.commit()

                        # Fetch recent probes for context
                        probes_q = (
                            select(HealthObservation)
                            .where(HealthObservation.service_id == service.id)
                            .order_by(HealthObservation.observed_at.desc())
                            .limit(5)
                        )
                        recent_obs = (await session.execute(probes_q)).scalars().all()
                        recent_probe_dicts = [
                            {
                                "id": o.id,
                                "http_status": o.http_status,
                                "latency_ms": o.latency_ms,
                                "success": o.success,
                                "sanitized_details": o.sanitized_details,
                            }
                            for o in recent_obs
                        ]

                        # Trigger triage flow asynchronously or inline
                        await handle_incident_flow(
                            session, active_incident, service, recent_probe_dicts
                        )

            else:
                # Successful probe
                service.consecutive_successes += 1
                service.consecutive_failures = 0

                # Check if an active incident is waiting in VERIFYING state
                if active_incident and active_incident.state == "VERIFYING":
                    logger.info(
                        f"Verification probe succeeded for incident {active_incident.id} ({service.consecutive_successes}/{settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE})"
                    )
                    await record_event(
                        session,
                        active_incident.id,
                        "VERIFICATION_PROBE_SUCCESS",
                        f"Health probe check {service.consecutive_successes}/{settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE} passed (latency: {probe['latency_ms']}ms).",
                        actor_type="SYSTEM",
                        actor_id="verification_engine",
                    )

                    if (
                        service.consecutive_successes
                        >= settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE
                    ):
                        now = get_utc_now()
                        active_incident.state = "RESOLVED"
                        active_incident.resolved_at = now
                        service.status = "HEALTHY"

                        # Compute MTTR safely across SQLite and PostgreSQL
                        detected_utc = ensure_utc(active_incident.detected_at)
                        mttr_seconds = round((now - detected_utc).total_seconds(), 1)
                        await record_event(
                            session,
                            active_incident.id,
                            "INCIDENT_RESOLVED",
                            f"Incident fully resolved. Recovery verified with {settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE} consecutive healthy probes. Measured MTTR: {mttr_seconds} seconds.",
                            actor_type="SYSTEM",
                            actor_id="verification_engine",
                            metadata={"mttr_seconds": mttr_seconds},
                        )
                        await create_notification(
                            session,
                            active_incident.id,
                            f"RESOLVED: {active_incident.title}. MTTR: {mttr_seconds}s.",
                        )
                        logger.info(
                            f"Incident {active_incident.id} marked RESOLVED. MTTR={mttr_seconds}s"
                        )
                elif not active_incident and service.status != "HEALTHY":
                    service.status = "HEALTHY"

            await session.commit()

            # Broadcast service status update
            await broadcaster.broadcast(
                "service_health",
                {
                    "id": service.id,
                    "slug": service.slug,
                    "status": service.status,
                    "latency_ms": probe["latency_ms"],
                    "last_checked_at": service.last_checked_at.isoformat()
                    if service.last_checked_at
                    else None,
                },
            )


async def run_monitor_worker():
    logger.info(
        f"[MonitorWorker] Starting daemon. Polling every {settings.HEALTH_CHECK_INTERVAL_SECONDS}s..."
    )
    while True:
        try:
            await monitor_iteration()
        except Exception as e:
            logger.error(f"[MonitorWorker] Error in monitor loop: {e}", exc_info=True)
        await asyncio.sleep(settings.HEALTH_CHECK_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(run_monitor_worker())
