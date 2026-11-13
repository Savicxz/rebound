import os
import sys
import subprocess
import pytest
import asyncio
import time
import httpx
from httpx import AsyncClient, ASGITransport

from services.api.main import app
from services.api.config import settings
from services.monitor_worker.worker import monitor_iteration


@pytest.fixture(scope="module", autouse=True)
def setup_teardown():
    # Launch supervisor as background subprocess
    supervisor_script = os.path.join(
        os.getcwd(), "services", "sandbox_runner", "supervisor.py"
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = os.getcwd()
    env["RUNNER_AUTH_TOKEN"] = settings.RUNNER_AUTH_TOKEN
    proc = subprocess.Popen(
        [sys.executable, supervisor_script],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait for supervisor and child service to be ready
    ready = False
    for _ in range(15):
        try:
            r = httpx.get(f"{settings.RUNNER_DEMO_SERVICE_URL}/health", timeout=1.0)
            if r.status_code == 200:
                ready = True
                break
        except Exception:
            time.sleep(0.5)

    if not ready:
        proc.kill()
        pytest.fail("Supervisor failed to start within timeout")

    # Initialize DB synchronously
    from services.api.seed import init_database_and_seed

    asyncio.run(init_database_and_seed())

    yield

    # Teardown
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            proc.terminate()
            proc.wait(timeout=3)
    except Exception:
        proc.kill()
    time.sleep(1.0)


@pytest.mark.asyncio
async def test_health_and_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Health
        res = await client.get("/api/v1/health")
        assert res.status_code == 200
        assert res.json()["status"] == "healthy"

        # 2. Login invalid
        res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrongpassword"},
        )
        assert res.status_code == 401

        # 3. Login valid operator
        res = await client.post(
            "/api/v1/auth/login",
            json={"username": "operator", "password": settings.OPERATOR_PASSWORD},
        )
        assert res.status_code == 200
        op_data = res.json()
        assert "access_token" in op_data
        assert op_data["user"]["role"] == "OPERATOR"
        op_token = op_data["access_token"]

        # 4. Login valid admin
        res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": settings.ADMIN_PASSWORD},
        )
        assert res.status_code == 200
        admin_data = res.json()
        assert admin_data["user"]["role"] == "ADMIN"
        admin_token = admin_data["access_token"]

        # 5. Dashboard
        res = await client.get("/api/v1/dashboard")
        assert res.status_code == 200
        dash = res.json()
        assert dash["metrics"]["monitored_services_count"] >= 1

        # 6. Role check: operator cannot call admin-only approve-runbook directly without admin role
        op_headers = {"Authorization": f"Bearer {op_token}"}
        res = await client.post(
            "/api/v1/incidents/nonexistent/approve-runbook",
            json={"runbook_id": "RESTART_DEMO_CHILD_SERVICE"},
            headers=op_headers,
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_policy_safety_guardrails():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": settings.ADMIN_PASSWORD},
        )
        admin_token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}

        # Try to execute a dangerous or unapproved runbook
        res = await client.post(
            "/api/v1/incidents/fake-id/approve-runbook",
            json={"runbook_id": "rm -rf /"},
            headers=headers,
        )
        # Should reject before finding incident or reject as 404/400
        assert res.status_code in [400, 404]


@pytest.mark.asyncio
async def test_end_to_end_scenario_a_crash_and_autorecovery():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/auth/login",
            json={"username": "operator", "password": settings.OPERATOR_PASSWORD},
        )
        token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Step 1: Ensure clean state via reset
        res = await client.post("/api/v1/demo/reset", headers=headers)
        assert res.status_code == 200
        await asyncio.sleep(0.5)

        # Step 2: Trigger crash scenario
        crash_res = await client.post(
            "/api/v1/demo/failures", json={"type": "crash"}, headers=headers
        )
        assert crash_res.status_code == 200
        await asyncio.sleep(0.5)

        # Step 3: Run monitor iterations (simulating background monitor daemon)
        # Probe 1: fails -> consecutive_failures = 1 (SUSPECTED)
        await monitor_iteration()
        # Probe 2: fails -> consecutive_failures = 2 (SUSPECTED)
        await monitor_iteration()
        # Probe 3: fails -> consecutive_failures = 3 -> triggers OPEN -> ANALYSIS -> POLICY -> RECOVERY -> VERIFYING!
        await monitor_iteration()
        await asyncio.sleep(1.0)

        # Step 4: Verify incident was opened and transitioned to VERIFYING
        dash_res = await client.get("/api/v1/dashboard")
        dash = dash_res.json()
        active = dash["active_incident"]
        assert active is not None
        assert active["state"] in ["VERIFYING", "RECOVERING", "RESOLVED"]
        assert active["auto_recovery_attempted"] is True

        # Step 5: Verification phase: child service is now back up!
        # Probe 4: success -> consecutive_successes = 1
        await monitor_iteration()
        # Probe 5: success -> consecutive_successes = 2 -> RESOLVED!
        await monitor_iteration()

        # Step 6: Verify incident is RESOLVED and MTTR is measured
        res = await client.get(f"/api/v1/incidents/{active['id']}")
        inc = res.json()
        assert inc["state"] == "RESOLVED"
        assert inc["resolved_at"] is not None

        # Verify audit trail has full sequence of events
        events_res = await client.get(f"/api/v1/incidents/{active['id']}/events")
        events = events_res.json()
        event_types = [e["event_type"] for e in events]
        assert "INCIDENT_OPENED" in event_types
        assert "ANALYSIS_COMPLETED" in event_types
        assert "POLICY_EVALUATED" in event_types
        assert "RECOVERY_STARTED" in event_types
        assert "RECOVERY_ACTION_COMPLETED" in event_types
        assert "INCIDENT_RESOLVED" in event_types


@pytest.mark.asyncio
async def test_end_to_end_scenario_b_degraded_escalation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/auth/login",
            json={"username": "operator", "password": settings.OPERATOR_PASSWORD},
        )
        token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Step 1: Reset demo to clean state
        res = await client.post("/api/v1/demo/reset", headers=headers)
        assert res.status_code == 200
        await asyncio.sleep(0.5)

        # Step 2: Trigger degraded scenario
        degrade_res = await client.post(
            "/api/v1/demo/failures", json={"type": "degraded"}, headers=headers
        )
        assert degrade_res.status_code == 200, (
            f"Degrade failure response: {degrade_res.text}"
        )
        await asyncio.sleep(0.5)

        # Step 3: Run monitor iterations
        await monitor_iteration()
        await monitor_iteration()
        await monitor_iteration()

        # Step 4: Verify incident opened, analyzed, and declined auto-recovery (AWAITING_APPROVAL / ESCALATED)
        dash_res = await client.get("/api/v1/dashboard")
        dash = dash_res.json()
        active = dash["active_incident"]
        assert active is not None
        assert active["state"] in ["AWAITING_APPROVAL", "ESCALATED"]
        # Crucial check: Auto-recovery MUST NOT have been attempted!
        assert active["auto_recovery_attempted"] is False

        # Verify events
        events_res = await client.get(f"/api/v1/incidents/{active['id']}/events")
        events = events_res.json()
        event_types = [e["event_type"] for e in events]
        assert "INCIDENT_OPENED" in event_types
        assert "ANALYSIS_COMPLETED" in event_types
        assert "POLICY_EVALUATED" in event_types
        assert "HUMAN_REVIEW_REQUIRED" in event_types
        assert "RECOVERY_STARTED" not in event_types


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scenario,expected_http",
    [
        ("auth_outage", 503),
        ("storage_full", 507),
        ("slow_assessment", 200),
        ("attendance_backlog", 429),
        ("attendance_down", 503),
        ("wifi_mesh", 503),
        ("exam_wifi", 503),
        ("intranet_dns", 503),
        ("projector_signal", 503),
        ("auditorium_audio", 503),
    ],
)
async def test_school_workflows_produce_real_evidence(scenario, expected_http):
    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(
        transport=transport,
        base_url="http://localhost:3000",
        headers={"Origin": "http://localhost:3000"},
    ) as client:
        session = await client.post("/api/v1/auth/demo")
        assert session.status_code == 200
        headers = {"Authorization": f"Bearer {session.json()['access_token']}"}
        assert (
            await client.post("/api/v1/demo/reset", headers=headers)
        ).status_code == 200
        before = (await client.get("/api/v1/demo/runtime", headers=headers)).json()
        assert (
            await client.post(
                "/api/v1/demo/failures", json={"type": scenario}, headers=headers
            )
        ).status_code == 200
        for _ in range(3):
            await monitor_iteration()
        dashboard = (await client.get("/api/v1/dashboard")).json()
        incident = dashboard["active_incident"]
        assert incident is not None
        probes = dashboard["recent_observations"]
        assert probes[0]["http_status"] == expected_http
        assert probes[0]["success"] is False
        assert "(demo)" in dashboard["services"][0]["display_name"]
        assert dashboard["demo_run"]["scenario_id"] == scenario
        assert dashboard["demo_run"]["incident_id"] == incident["id"]
        assert dashboard["demo_run"]["baseline"]["success"] is True
        if scenario in (
            "attendance_down",
            "wifi_mesh",
            "exam_wifi",
            "intranet_dns",
            "projector_signal",
            "auditorium_audio",
        ):
            receipt = (
                await client.post("/api/v1/demo/workflow-check", headers=headers)
            ).json()
            assert receipt["http_status"] == 503
            assert receipt["response"]["signals"]
            assert receipt["response"]["owner"]
            assert receipt["response"]["simulated"] is True
        if scenario == "attendance_backlog":
            assert incident["state"] == "VERIFYING"
            assert (
                incident["runbook_executions"][0]["runbook_id"]
                == "REPLAY_DEMO_ATTENDANCE_QUEUE"
            )
            events = " ".join(event["public_message"] for event in incident["events"])
            assert "12 synthetic attendance records" in events
            after = (await client.get("/api/v1/demo/runtime", headers=headers)).json()
            assert after["child_pid"] == before["child_pid"]
            assert after["restart_count"] == before["restart_count"]
            await monitor_iteration()
            await monitor_iteration()
            result = (await client.get(f"/api/v1/incidents/{incident['id']}")).json()
            assert result["state"] == "RESOLVED"
        else:
            assert incident["state"] in ("AWAITING_APPROVAL", "ESCALATED")
            assert not incident["auto_recovery_attempted"]
            assert incident["runbook_executions"] == []
            if scenario == "slow_assessment":
                assert probes[0]["latency_ms"] >= 800
            blocked = await client.post(
                "/api/v1/demo/failures", json={"type": "crash"}, headers=headers
            )
            assert blocked.status_code == 409
            await client.post("/api/v1/demo/reset", headers=headers)
            closed = (await client.get(f"/api/v1/incidents/{incident['id']}")).json()
            assert closed["state"] == "CLOSED" and closed["resolved_at"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "peer,origin,forwarded",
    [
        ("203.0.113.5", "http://localhost:3000", ""),
        ("127.0.0.1", "https://untrusted.example", ""),
        ("127.0.0.1", "", ""),
        ("127.0.0.1", "http://localhost:3000", "203.0.113.5"),
    ],
)
async def test_quick_demo_rejects_nonlocal_requests(peer, origin, forwarded):
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(peer, 1234)),
        base_url="http://localhost:3000",
    ) as client:
        response = await client.post(
            "/api/v1/auth/demo",
            headers={"Origin": origin, "X-Forwarded-For": forwarded},
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_hosted_judge_access_is_opt_in_and_operator_only(monkeypatch):
    from services.api.main import judge_access_attempts

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "PUBLIC_JUDGE_ACCESS", False)
    monkeypatch.setattr(
        settings, "PUBLIC_JUDGE_ORIGIN", "https://demo.example.com"
    )
    judge_access_attempts.clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://demo.example.com") as client:
        denied = await client.post(
            "/api/v1/auth/judge", headers={"Origin": "https://demo.example.com"}
        )
        assert denied.status_code == 403

        monkeypatch.setattr(settings, "PUBLIC_JUDGE_ACCESS", True)
        wrong_origin = await client.post(
            "/api/v1/auth/judge", headers={"Origin": "https://attacker.example.com"}
        )
        assert wrong_origin.status_code == 403
        missing_origin = await client.post("/api/v1/auth/judge")
        assert missing_origin.status_code == 403

        session = await client.post(
            "/api/v1/auth/judge",
            headers={"Origin": "https://demo.example.com", "Sec-Fetch-Site": "same-origin"},
        )
        assert session.status_code == 200
        assert session.json()["user"]["role"] == "OPERATOR"
        assert session.json()["user"]["username"] == settings.OPERATOR_USERNAME

        admin_action = await client.post(
            "/api/v1/incidents/nonexistent/approve-runbook",
            json={"runbook_id": "RESTART_DEMO_CHILD_SERVICE"},
            headers={"Authorization": f"Bearer {session.json()['access_token']}"},
        )
        assert admin_action.status_code == 403

        for _ in range(11):
            accepted = await client.post(
                "/api/v1/auth/judge", headers={"Origin": "https://demo.example.com"}
            )
            assert accepted.status_code == 200
        limited = await client.post(
            "/api/v1/auth/judge", headers={"Origin": "https://demo.example.com"}
        )
        assert limited.status_code == 429
    judge_access_attempts.clear()


@pytest.mark.asyncio
async def test_hosted_judge_cannot_run_in_local_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(settings, "PUBLIC_JUDGE_ACCESS", True)
    monkeypatch.setattr(settings, "PUBLIC_JUDGE_ORIGIN", "https://demo.example.com")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://demo.example.com") as client:
        response = await client.post(
            "/api/v1/auth/judge", headers={"Origin": "https://demo.example.com"}
        )
        assert response.status_code == 403
