import json
import asyncio
import time
from urllib.parse import urlsplit
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.future import select
from sqlalchemy import and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from services.api.config import settings
from services.api.database import get_db
from services.api.seed import init_database_and_seed
from services.api.models import (
    User,
    Service,
    Incident,
    IncidentEvent,
    AIAnalysis,
    RunbookExecution,
    Notification,
    Setting,
    HealthObservation,
    generate_uuid,
    get_utc_now,
)
from services.api.schemas import (
    UserLogin,
    TokenResponse,
    UserResponse,
    ServiceResponse,
    IncidentResponse,
    IncidentEventResponse,
    DashboardResponse,
    DashboardMetrics,
    NotificationResponse,
    DemoFailureRequest,
    RunbookActionRequest,
    AIAnalysisResult,
    RunbookExecutionResponse,
    HealthObservationResponse,
)
from services.api.security import (
    verify_password,
    create_access_token,
    get_current_user,
    require_operator,
    require_admin,
)
from services.api.events import broadcaster
from services.demo_scenarios import SCENARIOS
from services.api.policy import ALLOWLISTED_RUNBOOKS, execute_runbook
from services.monitor_worker.worker import record_event


def ensure_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema and seed demo records
    await init_database_and_seed()
    yield


app = FastAPI(
    title="Rebound API",
    description="Service monitoring, incident investigation and bounded recovery",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Auth Endpoints -----------------


@app.post("/api/v1/auth/login", response_model=TokenResponse)
async def login(
    credentials: UserLogin, response: Response, db: AsyncSession = Depends(get_db)
):
    q = select(User).where(User.username == credentials.username)
    res = await db.execute(q)
    user = res.scalars().first()

    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    return session_response(user, response)


def session_response(user: User, response: Response):
    token = create_access_token(data={"sub": user.username, "role": user.role})
    response.set_cookie(
        key="rebound_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.ENVIRONMENT != "demo",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return TokenResponse(
        access_token=token, token_type="bearer", user=UserResponse.model_validate(user)
    )


@app.post("/api/v1/auth/demo", response_model=TokenResponse)
async def start_local_demo(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
):
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    origin = urlsplit(request.headers.get("origin", ""))
    forwarded = request.headers.get("x-forwarded-for", "")
    forwarded_host = request.headers.get("x-forwarded-host")
    if (
        settings.ENVIRONMENT != "demo"
        or not settings.LOCAL_DEMO_ACCESS
        or not request.client
        or request.client.host not in local_hosts
        or origin.hostname not in local_hosts
        or origin.scheme not in ("http", "https")
        or any(
            part.strip() not in local_hosts
            for part in forwarded.split(",")
            if part.strip()
        )
        or (
            forwarded_host
            and urlsplit(f"http://{forwarded_host}").hostname not in local_hosts
        )
    ):
        raise HTTPException(
            status_code=403,
            detail="Quick demo access is available only on localhost. Use account access for another deployment.",
        )
    user = (
        (await db.execute(select(User).where(User.username == settings.ADMIN_USERNAME)))
        .scalars()
        .first()
    )
    if user is None:
        raise HTTPException(status_code=503, detail="Demo account is not ready")
    return session_response(user, response)


@app.get("/api/v1/auth/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@app.post("/api/v1/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="rebound_token")
    return {"status": "ok", "message": "Logged out successfully"}


# ----------------- Health & Dashboard -----------------


@app.get("/api/v1/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "rebound-api",
        "version": "1.0.0",
        "timestamp": get_utc_now().isoformat(),
        "simulated_environment": True,
        "gemini_api_configured": bool(settings.GEMINI_API_KEY),
    }


@app.get("/api/v1/dashboard", response_model=DashboardResponse)
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    # 1. Services
    services_res = await db.execute(select(Service))
    services = services_res.scalars().all()

    monitored_count = len(services)
    healthy_count = sum(1 for s in services if s.status == "HEALTHY")

    # 2. Incidents
    incidents_res = await db.execute(
        select(Incident).order_by(Incident.detected_at.desc())
    )
    all_incidents = incidents_res.scalars().all()

    open_incidents = [i for i in all_incidents if i.state not in ["RESOLVED", "CLOSED"]]
    resolved_incidents = [
        i for i in all_incidents if i.state == "RESOLVED" and i.resolved_at is not None
    ]

    # Calculate average MTTR
    avg_mttr = None
    if resolved_incidents:
        total_time = sum(
            (ensure_utc(i.resolved_at) - ensure_utc(i.detected_at)).total_seconds()
            for i in resolved_incidents
        )
        avg_mttr = round(total_time / len(resolved_incidents), 1)

    # Active Incident details
    active_incident_resp = None
    if open_incidents:
        active = open_incidents[0]
        # Load events, analysis, and runbooks
        ev_res = await db.execute(
            select(IncidentEvent)
            .where(IncidentEvent.incident_id == active.id)
            .order_by(IncidentEvent.sequence.asc())
        )
        active_events = ev_res.scalars().all()

        ai_res = await db.execute(
            select(AIAnalysis)
            .where(AIAnalysis.incident_id == active.id)
            .order_by(AIAnalysis.created_at.desc())
        )
        latest_ai = ai_res.scalars().first()
        latest_ai_parsed = None
        if latest_ai:
            try:
                latest_ai_parsed = AIAnalysisResult(**json.loads(latest_ai.result_json))
            except Exception:
                pass

        rb_res = await db.execute(
            select(RunbookExecution)
            .where(RunbookExecution.incident_id == active.id)
            .order_by(RunbookExecution.started_at.desc())
        )
        runbooks = rb_res.scalars().all()

        active_incident_resp = IncidentResponse(
            id=active.id,
            service_id=active.service_id,
            fingerprint=active.fingerprint,
            title=active.title,
            severity=active.severity,
            state=active.state,
            detected_at=active.detected_at,
            resolved_at=active.resolved_at,
            cause_code=active.cause_code,
            last_error=active.last_error,
            auto_recovery_attempted=active.auto_recovery_attempted,
            auto_recovery_cooldown_until=active.auto_recovery_cooldown_until,
            version=active.version,
            events=[IncidentEventResponse.model_validate(e) for e in active_events],
            latest_analysis=latest_ai_parsed,
            runbook_executions=[
                RunbookExecutionResponse.model_validate(r) for r in runbooks
            ],
        )

    # 3. Recent Events across system
    recent_events_res = await db.execute(
        select(IncidentEvent).order_by(IncidentEvent.at.desc()).limit(20)
    )
    recent_events = recent_events_res.scalars().all()

    # 4. Recent Notifications
    notifs_res = await db.execute(
        select(Notification).order_by(Notification.created_at.desc()).limit(10)
    )
    recent_notifs = notifs_res.scalars().all()

    latest_analysis = (
        (
            await db.execute(
                select(AIAnalysis).order_by(AIAnalysis.created_at.desc()).limit(1)
            )
        )
        .scalars()
        .first()
    )
    if settings.GEMINI_ENTERPRISE_ENABLED:
        gemini_status = "enterprise_unavailable"
    elif not settings.GEMINI_API_KEY:
        gemini_status = "not_configured"
    elif latest_analysis is None:
        gemini_status = "configured"
    else:
        gemini_status = (
            "verified" if latest_analysis.provider == "gemini_api" else "fallback"
        )

    metrics = DashboardMetrics(
        monitored_services_count=monitored_count,
        healthy_services_count=healthy_count,
        open_incidents_count=len(open_incidents),
        total_recovered_count=len(resolved_incidents),
        average_recovery_time_seconds=avg_mttr,
        simulation_label=settings.SIMULATION_LABEL,
        gemini_status=gemini_status,
        last_analysis_provider=latest_analysis.provider if latest_analysis else None,
        last_analysis_at=latest_analysis.created_at if latest_analysis else None,
    )

    return DashboardResponse(
        metrics=metrics,
        services=[ServiceResponse.model_validate(s) for s in services],
        active_incident=active_incident_resp,
        recent_events=[IncidentEventResponse.model_validate(e) for e in recent_events],
        recent_notifications=[
            NotificationResponse.model_validate(n) for n in recent_notifs
        ],
        recent_observations=[
            HealthObservationResponse.model_validate(observation)
            for observation in (
                await db.execute(
                    select(HealthObservation)
                    .order_by(HealthObservation.observed_at.desc())
                    .limit(120)
                )
            )
            .scalars()
            .all()
        ],
    )


# ----------------- Services & Incidents -----------------


@app.get("/api/v1/audit-events")
async def list_audit_events(
    limit: int = Query(50, ge=1, le=100),
    before_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(IncidentEvent).order_by(
        IncidentEvent.at.desc(), IncidentEvent.id.desc()
    )
    if before_id:
        cursor = await db.get(IncidentEvent, before_id)
        if cursor is None:
            raise HTTPException(
                status_code=404,
                detail="Audit cursor no longer exists. Refresh the audit history.",
            )
        query = query.where(
            or_(
                IncidentEvent.at < cursor.at,
                and_(IncidentEvent.at == cursor.at, IncidentEvent.id < cursor.id),
            )
        )
    records = (await db.execute(query.limit(limit + 1))).scalars().all()
    return {
        "events": [
            IncidentEventResponse.model_validate(event) for event in records[:limit]
        ],
        "next_cursor": records[limit - 1].id if len(records) > limit else None,
    }


@app.get("/api/v1/demo/runtime")
async def get_demo_runtime(current_user: User = Depends(require_operator)):
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(
                f"{settings.RUNNER_CONTROL_URL}/internal/v1/runner-status",
                headers={"X-Runner-Token": settings.RUNNER_AUTH_TOKEN},
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict) or not isinstance(
                data.get("child_running"), bool
            ):
                raise ValueError("Supervisor did not report a valid process state")
        return {
            "observed_at": datetime.now(timezone.utc).isoformat(),
            **{
                key: data.get(key)
                for key in (
                    "child_running",
                    "child_pid",
                    "mode",
                    "restart_count",
                    "last_action",
                    "last_action_timestamp",
                )
            },
        }
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=503,
            detail="Sandbox supervisor is unavailable. Runtime state could not be verified.",
        )


@app.get("/api/v1/services", response_model=List[ServiceResponse])
async def list_services(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Service))
    return [ServiceResponse.model_validate(s) for s in res.scalars().all()]


@app.get("/api/v1/services/{service_id}", response_model=ServiceResponse)
async def get_service(service_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Service).where(Service.id == service_id))
    svc = res.scalars().first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceResponse.model_validate(svc)


@app.get("/api/v1/incidents", response_model=List[IncidentResponse])
async def list_incidents(
    state: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Incident).order_by(Incident.detected_at.desc()).limit(limit)
    if state:
        q = q.where(Incident.state == state)
    res = await db.execute(q)
    incidents = res.scalars().all()

    output = []
    for inc in incidents:
        # Load events
        ev_res = await db.execute(
            select(IncidentEvent)
            .where(IncidentEvent.incident_id == inc.id)
            .order_by(IncidentEvent.sequence.asc())
        )
        events = ev_res.scalars().all()

        # Load latest analysis
        ai_res = await db.execute(
            select(AIAnalysis)
            .where(AIAnalysis.incident_id == inc.id)
            .order_by(AIAnalysis.created_at.desc())
        )
        ai_rec = ai_res.scalars().first()
        ai_parsed = None
        if ai_rec:
            try:
                ai_parsed = AIAnalysisResult(**json.loads(ai_rec.result_json))
            except Exception:
                pass

        # Load runbooks
        rb_res = await db.execute(
            select(RunbookExecution).where(RunbookExecution.incident_id == inc.id)
        )
        runbooks = rb_res.scalars().all()

        output.append(
            IncidentResponse(
                id=inc.id,
                service_id=inc.service_id,
                fingerprint=inc.fingerprint,
                title=inc.title,
                severity=inc.severity,
                state=inc.state,
                detected_at=inc.detected_at,
                resolved_at=inc.resolved_at,
                cause_code=inc.cause_code,
                last_error=inc.last_error,
                auto_recovery_attempted=inc.auto_recovery_attempted,
                auto_recovery_cooldown_until=inc.auto_recovery_cooldown_until,
                version=inc.version,
                events=[IncidentEventResponse.model_validate(e) for e in events],
                latest_analysis=ai_parsed,
                runbook_executions=[
                    RunbookExecutionResponse.model_validate(r) for r in runbooks
                ],
            )
        )
    return output


@app.get("/api/v1/incidents/{incident_id}", response_model=IncidentResponse)
async def get_incident(incident_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Incident).where(Incident.id == incident_id))
    inc = res.scalars().first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    ev_res = await db.execute(
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == inc.id)
        .order_by(IncidentEvent.sequence.asc())
    )
    events = ev_res.scalars().all()

    ai_res = await db.execute(
        select(AIAnalysis)
        .where(AIAnalysis.incident_id == inc.id)
        .order_by(AIAnalysis.created_at.desc())
    )
    ai_rec = ai_res.scalars().first()
    ai_parsed = None
    if ai_rec:
        try:
            ai_parsed = AIAnalysisResult(**json.loads(ai_rec.result_json))
        except Exception:
            pass

    rb_res = await db.execute(
        select(RunbookExecution)
        .where(RunbookExecution.incident_id == inc.id)
        .order_by(RunbookExecution.started_at.desc())
    )
    runbooks = rb_res.scalars().all()

    return IncidentResponse(
        id=inc.id,
        service_id=inc.service_id,
        fingerprint=inc.fingerprint,
        title=inc.title,
        severity=inc.severity,
        state=inc.state,
        detected_at=inc.detected_at,
        resolved_at=inc.resolved_at,
        cause_code=inc.cause_code,
        last_error=inc.last_error,
        auto_recovery_attempted=inc.auto_recovery_attempted,
        auto_recovery_cooldown_until=inc.auto_recovery_cooldown_until,
        version=inc.version,
        events=[IncidentEventResponse.model_validate(e) for e in events],
        latest_analysis=ai_parsed,
        runbook_executions=[
            RunbookExecutionResponse.model_validate(r) for r in runbooks
        ],
    )


@app.get(
    "/api/v1/incidents/{incident_id}/events", response_model=List[IncidentEventResponse]
)
async def get_incident_events(incident_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.sequence.asc())
    )
    return [IncidentEventResponse.model_validate(e) for e in res.scalars().all()]


@app.get("/api/v1/audit", response_model=List[IncidentEventResponse])
async def get_audit_trail(
    incident_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    q = select(IncidentEvent).order_by(IncidentEvent.at.desc()).limit(limit)
    if incident_id:
        q = q.where(IncidentEvent.incident_id == incident_id)
    res = await db.execute(q)
    return [IncidentEventResponse.model_validate(e) for e in res.scalars().all()]


# ----------------- Real-time SSE Stream -----------------


@app.get("/api/v1/events/stream")
async def events_stream(request: Request):
    queue = await broadcaster.subscribe()

    async def event_generator():
        try:
            # Send initial connected ping
            yield f"data: {json.dumps({'type': 'CONNECTED', 'timestamp': get_utc_now().isoformat()})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    # Wait up to 15s for an event, then send heartbeat
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(message)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'HEARTBEAT', 'timestamp': get_utc_now().isoformat()})}\n\n"
        finally:
            broadcaster.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ----------------- Demo Controls & Scenario Triggering -----------------


@app.get("/api/v1/demo/scenarios")
async def demo_scenarios():
    return [
        {"id": scenario_id, **scenario} for scenario_id, scenario in SCENARIOS.items()
    ]


@app.post("/api/v1/demo/failures")
async def trigger_demo_failure(
    req: DemoFailureRequest,
    current_user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """
    Simulates a genuine service fault in the isolated sandbox:
    - crash: terminates the supervised child process
    - degraded: switches child service to degraded mode (HTTP 500)
    """
    scenario_type = "degrade" if req.type in ["degrade", "degraded"] else req.type
    active = (
        (
            await db.execute(
                select(Incident).where(Incident.state.notin_(["RESOLVED", "CLOSED"]))
            )
        )
        .scalars()
        .first()
    )
    if active:
        raise HTTPException(
            status_code=409,
            detail="Reset or finish the active incident before starting another scenario",
        )
    target_endpoint = (
        f"{settings.RUNNER_CONTROL_URL}/internal/v1/scenario/{scenario_type}"
    )
    headers = {"X-Runner-Token": settings.RUNNER_AUTH_TOKEN}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(target_endpoint, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Runner error: status={resp.status_code} body={resp.text}",
                )
            runner_data = resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to communicate with sandbox runner: {str(e)}",
        )

    service = (
        (await db.execute(select(Service).where(Service.slug == "demo-service")))
        .scalars()
        .first()
    )
    if service:
        service.display_name = f"{SCENARIOS[req.type]['workflow']} (demo)"
        service.status = "SUSPECTED"
        service.consecutive_failures = 0
        service.consecutive_successes = 0
        await db.commit()
    return {
        "status": "ok",
        "scenario": req.type,
        "message": f"Simulated {req.type} executed on sandbox child process.",
        "runner_response": runner_data,
        "initiated_by": current_user.username,
    }


@app.post("/api/v1/demo/reset")
async def reset_demo(
    current_user: User = Depends(require_operator), db: AsyncSession = Depends(get_db)
):
    """
    Resets the isolated supervisor child process to normal mode,
    clears open incidents, and resets consecutive probe counters.
    """
    # 1. Reset runner supervisor
    target_endpoint = f"{settings.RUNNER_CONTROL_URL}/internal/v1/scenario/reset"
    headers = {"X-Runner-Token": settings.RUNNER_AUTH_TOKEN}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(target_endpoint, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(
            status_code=503,
            detail="Sandbox reset failed; recorded incident state has been preserved",
        )

    # 2. Reset services in DB
    svc_res = await db.execute(select(Service))
    services = svc_res.scalars().all()
    for s in services:
        s.status = "SUSPECTED"
        s.consecutive_failures = 0
        s.consecutive_successes = 0

    # 3. Close open incidents
    inc_res = await db.execute(
        select(Incident).where(Incident.state.notin_(["RESOLVED", "CLOSED"]))
    )
    open_incidents = inc_res.scalars().all()
    for inc in open_incidents:
        inc.state = "CLOSED"
        await record_event(
            db,
            inc.id,
            "INCIDENT_CLOSED_RESET",
            f"Incident administratively closed during demo reset by {current_user.username}.",
            actor_type="OPERATOR",
            actor_id=current_user.username,
        )

    await db.commit()
    await broadcaster.broadcast(
        "demo_reset",
        {"actor": current_user.username, "timestamp": get_utc_now().isoformat()},
    )

    return {
        "status": "ok",
        "message": "Sandbox reset. Waiting for an independent healthy probe; active incidents were closed, not marked recovered.",
    }


# ----------------- Incident Actions & Approvals -----------------


@app.post("/api/v1/incidents/{incident_id}/acknowledge")
async def acknowledge_incident(
    incident_id: str,
    current_user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Incident).where(Incident.id == incident_id))
    inc = res.scalars().first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    await record_event(
        db,
        inc.id,
        "INCIDENT_ACKNOWLEDGED",
        f"Incident acknowledged by operator {current_user.username}.",
        actor_type="OPERATOR",
        actor_id=current_user.username,
    )
    await db.commit()
    return {"status": "ok", "incident_id": inc.id, "state": inc.state}


@app.post("/api/v1/incidents/{incident_id}/approve-runbook")
async def approve_runbook(
    incident_id: str,
    req: RunbookActionRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin-only guarded approval for recovery runbooks.
    Validates runbook allowlist and executes recovery.
    """
    res = await db.execute(select(Incident).where(Incident.id == incident_id))
    inc = res.scalars().first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    if inc.state in ["RESOLVED", "CLOSED"]:
        raise HTTPException(
            status_code=400, detail="Incident is already resolved or closed."
        )

    if req.runbook_id not in ALLOWLISTED_RUNBOOKS:
        raise HTTPException(
            status_code=400, detail=f"Runbook '{req.runbook_id}' is not allowlisted."
        )

    # Execute recovery runbook
    inc.state = "RECOVERING"
    await db.commit()
    await broadcaster.broadcast(
        "incident_state", {"incident_id": inc.id, "state": "RECOVERING"}
    )

    idempotency_key = f"admin_rec_{inc.id}_{int(time.time())}"
    runbook_exec = RunbookExecution(
        id=generate_uuid(),
        incident_id=inc.id,
        runbook_id=req.runbook_id,
        idempotency_key=idempotency_key,
        status="RUNNING",
        approval_actor_id=current_user.username,
        started_at=get_utc_now(),
    )
    db.add(runbook_exec)
    await db.commit()

    await record_event(
        db,
        inc.id,
        "ADMIN_APPROVAL_GRANTED",
        f"Admin {current_user.username} approved execution of {req.runbook_id}. Justification: {req.justification or 'None provided'}",
        actor_type="ADMIN",
        actor_id=current_user.username,
    )

    success, msg = await execute_runbook(
        runbook_id=req.runbook_id,
        incident_id=inc.id,
        idempotency_key=idempotency_key,
        actor_id=current_user.username,
    )

    runbook_exec.finished_at = get_utc_now()
    runbook_exec.runner_response_redacted = msg

    if success:
        runbook_exec.status = "SUCCESS"
        inc.state = "VERIFYING"
        # Reset consecutive successes on service to trigger verification
        svc_res = await db.execute(select(Service).where(Service.id == inc.service_id))
        svc = svc_res.scalars().first()
        if svc:
            svc.consecutive_successes = 0

        await record_event(
            db,
            inc.id,
            "RECOVERY_ACTION_COMPLETED",
            f"Runbook execution completed. System in VERIFYING state.",
            actor_type="SYSTEM",
            actor_id="runbook_executor",
            metadata={"runner_response": msg},
        )
    else:
        runbook_exec.status = "FAILED"
        inc.state = "ESCALATED"
        await record_event(
            db,
            inc.id,
            "RECOVERY_FAILED",
            f"Runbook execution failed: {msg}.",
            actor_type="SYSTEM",
            actor_id="runbook_executor",
        )

    await db.commit()
    await broadcaster.broadcast(
        "incident_state", {"incident_id": inc.id, "state": inc.state}
    )
    return {"status": "ok", "incident_id": inc.id, "state": inc.state, "message": msg}


@app.post("/api/v1/incidents/{incident_id}/reject-runbook")
async def reject_runbook(
    incident_id: str,
    req: RunbookActionRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Incident).where(Incident.id == incident_id))
    inc = res.scalars().first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.state = "ESCALATED"
    await record_event(
        db,
        inc.id,
        "ADMIN_APPROVAL_REJECTED",
        f"Admin {current_user.username} rejected action {req.runbook_id}. Reason: {req.justification or 'Safety refusal'}.",
        actor_type="ADMIN",
        actor_id=current_user.username,
    )
    await db.commit()
    await broadcaster.broadcast(
        "incident_state", {"incident_id": inc.id, "state": "ESCALATED"}
    )
    return {"status": "ok", "incident_id": inc.id, "state": "ESCALATED"}


# ----------------- Settings -----------------


@app.get("/api/v1/settings")
async def get_settings(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Setting).where(Setting.key == "platform_config"))
    setting = res.scalars().first()
    data = json.loads(setting.json_value) if setting else {}
    data["gemini_configured"] = bool(settings.GEMINI_API_KEY)
    data.update(
        {
            "health_interval": settings.HEALTH_CHECK_INTERVAL_SECONDS,
            "health_timeout": settings.HEALTH_CHECK_TIMEOUT_SECONDS,
            "latency_limit_ms": settings.HEALTH_LATENCY_LIMIT_MS,
            "failure_threshold": settings.CONSECUTIVE_FAILURES_TO_OPEN,
            "verification_threshold": settings.CONSECUTIVE_SUCCESSES_TO_RESOLVE,
            "max_auto_recovery_attempts": settings.MAX_AUTO_RECOVERY_ATTEMPTS,
            "cooldown_seconds": settings.AUTO_RECOVERY_COOLDOWN_SECONDS,
            "gemini_model": settings.GEMINI_MODEL,
            "simulation_label": settings.SIMULATION_LABEL,
            "auto_recovery_enabled": True,
        }
    )
    return data
