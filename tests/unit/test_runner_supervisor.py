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

    # Wait a moment for child process to bind
    time.sleep(1.5)

    # Verify child service is reachable on port 5006
    try:
        child_res = httpx.get(
            f"http://127.0.0.1:{RUNNER_DEMO_PORT}/health", timeout=3.0
        )
        assert child_res.status_code == 200
        assert child_res.json()["status"] == "healthy"
    except Exception as e:
        pytest.fail(f"Could not connect to child service: {e}")

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

    time.sleep(1.5)
    # Verify child service is back up
    child_res_restarted = httpx.get(
        f"http://127.0.0.1:{RUNNER_DEMO_PORT}/health", timeout=3.0
    )
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
