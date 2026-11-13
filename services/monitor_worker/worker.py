import asyncio
import time
import json
import logging
import signal
from datetime import timezone, timedelta, datetime
import httpx
from sqlalchemy.future import select
from sqlalchemy import update

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
from services.api.analyzer import get_analyzer, sanitize_logs, DeterministicDemoAnalyzer
from services.api.policy import evaluate_incident_policy, execute_runbook
from services.api.http_client import transport_client

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
    # Serialize appenders on the incident before assigning a sequence. This works
    # on SQLite (writer lock) and PostgreSQL (row lock), including API writers.
    # Consistent service -> incident lock order with probe/reset writers on PostgreSQL.
    await session.execute(
        select(Service.id)
        .join(Incident, Incident.service_id == Service.id)
        .where(Incident.id == incident_id)
        .with_for_update(of=Service)
    )
    await session.execute(
        update(Incident)
        .where(Incident.id == incident_id)
        .values(version=Incident.version + 1)
    )
    q = (
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.sequence.desc())
        .limit(1)
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


async def probe_service(service: Service, client=None) -> dict:
    url = service.health_url
    start = time.perf_counter()
    status_code = None
    success = False
    error_type = None
    details = ""

    try:
        async with probe_client(client) as client:
            start = time.perf_counter()
            resp = await client.get(url, timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS)
            latency = (time.perf_counter() - start) * 1000.0
            status_code = resp.status_code
            if status_code == 200:
                success = latency <= settings.HEALTH_LATENCY_LIMIT_MS
                error_type = None if success else "SLOW_RESPONSE"
                details = (
                    resp.text[:200]
                    if success
                    else f"SLOW_RESPONSE: measured {latency:.1f} ms exceeds {settings.HEALTH_LATENCY_LIMIT_MS} ms limit"
                )
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
    claimed = await session.execute(
        update(Incident)
        .where(Incident.id == incident.id, Incident.state == "OPEN")
        .values(state="ANALYZING")
    )
    session.info["realtime_changed"] = bool(claimed.rowcount)
    await session.commit()
    if not claimed.rowcount:
        return
    await session.refresh(incident)
    await session.commit()  # release read transaction while the provider is pending

    # 1. AI Analysis
    analyzer = get_analyzer()
    arguments = dict(
        incident_id=incident.id,
        service_name=service.display_name,
        recent_probes=recent_probes,
        last_error=incident.last_error,
    )
    try:
        analysis_result = await asyncio.wait_for(
            analyzer.analyze(**arguments), timeout=settings.ANALYSIS_TIMEOUT_SECONDS
        )
    except Exception as error:
        logger.warning(
            "Analysis failed (%s); using labelled fallback", type(error).__name__
        )
        analysis_result = await DeterministicDemoAnalyzer().analyze(**arguments)
        analysis_result.fallback_reason = (
            f"Analysis unavailable ({type(error).__name__})"
        )
    # Reset or operator actions may have changed the incident while analysis ran.
    await session.refresh(incident)
    await session.refresh(service)
    if incident.state != "ANALYZING":
        return

    # Persist AI analysis
    ai_record = AIAnalysis(
        id=generate_uuid(),
        incident_id=incident.id,
        provider=analysis_result.provider,
        schema_version="1.0",
        result_json=analysis_result.model_dump_json(),
        model_id=(
            getattr(analyzer, "model_id", "unknown")
            if analysis_result.provider == "gemini_api"
            else "deterministic_engine"
        ),
        error=analysis_result.fallback_reason,
        created_at=get_utc_now(),
    )
    session.add(ai_record)
    # Buffered provider trace records only actual operations; preserve occurrence times.
    for step in (analysis_result.investigation or {}).get("steps", []):
        event = await record_event(
            session,
            incident.id,
            step["event_type"],
            step["summary"],
            actor_type="AI",
            actor_id="gemini_api",
            metadata=step,
        )
        event.at = datetime.fromisoformat(step["at"])
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
        claim = await session.execute(
            update(Incident)
            .where(
                Incident.id == incident.id,
                Incident.state == "ANALYZING",
                Incident.auto_recovery_attempted.is_(False),
            )
            .values(
                state="RECOVERING",
                auto_recovery_attempted=True,
                auto_recovery_cooldown_until=get_utc_now()
                + timedelta(seconds=settings.AUTO_RECOVERY_COOLDOWN_SECONDS),
            )
        )
        if not claim.rowcount:
            await session.rollback()
            return
        session.info["realtime_changed"] = True

        idempotency_key = f"rec_{incident.id}"
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

        await session.commit()  # never hold a database write lock across runner I/O
        success, msg = await execute_runbook(
            runbook_id=policy_decision.runbook_id,
            incident_id=incident.id,
            idempotency_key=idempotency_key,
        )

        await session.refresh(incident)
        await session.refresh(service)
        runbook_exec.finished_at = get_utc_now()
        runbook_exec.runner_response_redacted = msg
        if incident.state != "RECOVERING":
            runbook_exec.status = "SUCCESS" if success else "FAILED"
            await session.commit()
            return  # reset/closure never becomes verified recovery

        if success:
            runbook_exec.status = "SUCCESS"
            incident.state = "VERIFYING"
            service.consecutive_successes = 0  # reset verification counter
            await record_event(
                session,
                incident.id,
                "RECOVERY_ACTION_COMPLETED",
                f"{msg} Transitioning to VERIFYING state (awaiting {settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE} healthy probes).",
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
        transition = await session.execute(
            update(Incident)
            .where(Incident.id == incident.id, Incident.state == "ANALYZING")
            .values(state=policy_decision.state_transition)
        )
        if not transition.rowcount:
            await session.rollback()
            return
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


def ensure_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def monitor_iteration(processor=None, client=None):
    """Single polling and state transition tick."""
    async with AsyncSessionLocal() as session:
        # Load all monitored services
        q = select(Service)
        res = await session.execute(q)
        services = res.scalars().all()

        for service in services:
            probe = await probe_service(service, client)
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
                        if processor is None:
                            # Explicit one-shot calls retain their historical awaitable contract.
                            await handle_incident_flow(
                                session, active_incident, service, recent_probe_dicts
                            )
                        else:
                            processor.submit(active_incident.id)

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


from contextlib import asynccontextmanager


@asynccontextmanager
async def probe_client(client=None):
    if client is not None:
        yield client
    else:
        async with httpx.AsyncClient(
            timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS
        ) as owned:
            yield owned


class IncidentProcessor:
    """Bounded tasks; durable OPEN claims prevent duplicate triage across workers."""

    def __init__(self):
        self.tasks = {}

    def submit(self, incident_id):
        if (
            incident_id in self.tasks
            or len(self.tasks) >= settings.INCIDENT_CONCURRENCY
        ):
            return
        task = asyncio.create_task(self.process(incident_id))
        self.tasks[incident_id] = task
        task.add_done_callback(lambda done: self.finished(incident_id, done))

    def finished(self, incident_id, task):
        self.tasks.pop(incident_id, None)
        if not task.cancelled() and task.exception():
            logger.error("Incident task failed: %s", task.exception())

    async def process(self, incident_id):
        async with AsyncSessionLocal() as session:
            incident = await session.get(Incident, incident_id)
            if not incident or incident.state != "OPEN":
                return
            service = await session.get(Service, incident.service_id)
            probes = (
                (
                    await session.execute(
                        select(HealthObservation)
                        .where(HealthObservation.service_id == service.id)
                        .order_by(HealthObservation.observed_at.desc())
                        .limit(5)
                    )
                )
                .scalars()
                .all()
            )
            evidence = [
                {
                    "id": p.id,
                    "http_status": p.http_status,
                    "latency_ms": p.latency_ms,
                    "success": p.success,
                    "sanitized_details": p.sanitized_details,
                }
                for p in probes
            ]
            try:
                await handle_incident_flow(session, incident, service, evidence)
            except BaseException:
                await session.rollback()
                await session.refresh(incident)
                if incident.state in ("ANALYZING", "RECOVERING"):
                    incident.state = "ESCALATED"
                    running = (
                        (
                            await session.execute(
                                select(RunbookExecution).where(
                                    RunbookExecution.incident_id == incident.id,
                                    RunbookExecution.status == "RUNNING",
                                )
                            )
                        )
                        .scalars()
                        .all()
                    )
                    for execution in running:
                        execution.status = "FAILED"
                        execution.finished_at = get_utc_now()
                        execution.runner_response_redacted = "Processing interrupted; external action completion is unknown. Do not retry automatically."
                    await record_event(
                        session,
                        incident.id,
                        "PROCESSING_INTERRUPTED",
                        "Incident processing interrupted. An external action may be incomplete; human investigation required.",
                    )
                    await session.commit()
                raise

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_monitor_worker():
    logger.info(
        f"[MonitorWorker] Starting daemon. Polling every {settings.HEALTH_CHECK_INTERVAL_SECONDS}s..."
    )
    loop = asyncio.get_running_loop()
    main_task = asyncio.current_task()
    if hasattr(loop, "add_signal_handler"):
        try:
            loop.add_signal_handler(signal.SIGTERM, main_task.cancel)
        except NotImplementedError:
            pass  # Windows launchers terminate their owned process tree.
    processor = IncidentProcessor()
    async with httpx.AsyncClient(
        timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS
    ) as client:
        token = transport_client.set(client)
        try:
            while True:
                started = time.monotonic()
                try:
                    await monitor_iteration(processor, client)
                    async with AsyncSessionLocal() as session:
                        pending = (
                            (
                                await session.execute(
                                    select(Incident.id)
                                    .where(Incident.state == "OPEN")
                                    .limit(settings.INCIDENT_CONCURRENCY)
                                )
                            )
                            .scalars()
                            .all()
                        )
                    for incident_id in pending:
                        processor.submit(incident_id)
                except Exception as error:
                    logger.error("Monitor tick failed: %s", error, exc_info=True)
                await asyncio.sleep(
                    max(
                        0,
                        settings.HEALTH_CHECK_INTERVAL_SECONDS
                        - (time.monotonic() - started),
                    )
                )
        finally:
            await processor.close()
            transport_client.reset(token)


if __name__ == "__main__":
    try:
        asyncio.run(run_monitor_worker())
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
