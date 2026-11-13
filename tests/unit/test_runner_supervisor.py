import pytest
import time
import httpx
from fastapi.testclient import TestClient
from services.sandbox_runner.supervisor import (
    app,
    RUNNER_DEMO_PORT,
    RUNNER_AUTH_TOKEN,
    stop_child_process,
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    stop_child_process()


def test_runner_auth_required(client):
    res = client.get("/internal/v1/runner-status")
    assert res.status_code == 401

    res = client.get(
        "/internal/v1/runner-status", headers={"X-Runner-Token": "invalid_token"}
    )
    assert res.status_code == 401


def wait_for_child():
    """Wait for actual readiness, not a machine-dependent process startup sleep."""
    deadline = time.monotonic() + 10
    while True:
        try:
            response = httpx.get(
                f"http://127.0.0.1:{RUNNER_DEMO_PORT}/health", timeout=1
            )
            if response.status_code == 200:
                return response
        except httpx.TransportError:
            pass
        if time.monotonic() >= deadline:
            pytest.fail("Child did not become healthy within 10 seconds")
        time.sleep(0.1)


def test_runner_status_and_lifecycle(client):
    headers = {"X-Runner-Token": RUNNER_AUTH_TOKEN}

    # 0. Ensure clean state
    client.post("/internal/v1/scenario/reset", headers=headers)
    time.sleep(1.0)

    # 1. Check initial status
    res = client.get("/internal/v1/runner-status", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["child_running"] is True
    assert data["child_pid"] is not None

    child_res = wait_for_child()
    assert child_res.status_code == 200
    assert child_res.json()["status"] == "healthy"

    # 2. Crash scenario
    crash_res = client.post("/internal/v1/scenario/crash", headers=headers)
    assert crash_res.status_code == 200
    assert crash_res.json()["action"] == "CRASH_EXECUTED"

    time.sleep(0.5)
    # Verify child service is down
    with pytest.raises(Exception):
        httpx.get(f"http://127.0.0.1:{RUNNER_DEMO_PORT}/health", timeout=1.0)

    # 3. Restart runbook
    restart_res = client.post(
        "/internal/v1/runbooks/restart-demo-child", headers=headers
    )
    assert restart_res.status_code == 200
    assert restart_res.json()["action"] == "RESTART_DEMO_CHILD_EXECUTED"

    # Verify actual readiness after the restart.
    child_res_restarted = wait_for_child()
    assert child_res_restarted.status_code == 200
    assert child_res_restarted.json()["status"] == "healthy"

    # 4. Degrade scenario
    degrade_res = client.post("/internal/v1/scenario/degrade", headers=headers)
    assert degrade_res.status_code == 200
    time.sleep(1.5)
    child_res_degraded = httpx.get(
        f"http://127.0.0.1:{RUNNER_DEMO_PORT}/health", timeout=3.0
    )
    assert child_res_degraded.status_code == 500
    assert child_res_degraded.json()["error_type"] == "DATABASE_POOL_EXHAUSTED"

    # 5. Reset
    reset_res = client.post("/internal/v1/scenario/reset", headers=headers)
    assert reset_res.status_code == 200
    time.sleep(1.5)
    child_res_reset = httpx.get(
        f"http://127.0.0.1:{RUNNER_DEMO_PORT}/health", timeout=3.0
    )
    assert child_res_reset.status_code == 200
    assert child_res_reset.json()["status"] == "healthy"
