"""Real local test stack. Never reuses the developer's database, credentials or ports."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

import httpx

root = Path(__file__).resolve().parents[3]
logs = root / ".logs" / "e2e"
logs.mkdir(parents=True, exist_ok=True)
directory = tempfile.TemporaryDirectory(
    prefix="studio-", dir=logs, ignore_cleanup_errors=True
)
env = os.environ.copy()
env.update(
    {
        "ENVIRONMENT": "demo",
        "LOCAL_DEMO_ACCESS": "true",
        "DATABASE_URL": f"sqlite+aiosqlite:///{(Path(directory.name) / 'test.sqlite').as_posix()}",
        "SECRET_KEY": "e2e-ephemeral-test-session-secret-not-for-production",
        "RUNNER_AUTH_TOKEN": "e2e-isolated-runner-token-not-for-production",
        "ADMIN_USERNAME": "admin",
        "ADMIN_PASSWORD": "E2eAdminPassword2026!",
        "OPERATOR_USERNAME": "operator",
        "OPERATOR_PASSWORD": "E2eOperatorPassword2026!",
        "RUNNER_CONTROL_PORT": "5107",
        "RUNNER_DEMO_PORT": "5108",
        "RUNNER_CONTROL_URL": "http://127.0.0.1:5107",
        "RUNNER_DEMO_SERVICE_URL": "http://127.0.0.1:5108",
        "HEALTH_CHECK_INTERVAL_SECONDS": "2",
        "HEALTH_CHECK_TIMEOUT_SECONDS": "2",
        "HEALTH_LATENCY_LIMIT_MS": "500",
        "CONSECUTIVE_FAILURES_TO_OPEN": "3",
        "CONSECUTIVE_SUCCESSES_TO_RESOLVE": "2",
        "GEMINI_API_KEY": "",
        "GEMINI_ENTERPRISE_ENABLED": "false",
        "PYTHONPATH": str(root),
    }
)
processes = []
handles = []


def start(name, command):
    handle = (logs / f"{name}.log").open("w", encoding="utf-8")
    handles.append(handle)
    processes.append(
        subprocess.Popen(
            command,
            cwd=root,
            env=env,
            stdout=handle,
            stderr=handle,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    )


def stop(_signal, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
try:
    start("runner", [sys.executable, "-m", "services.sandbox_runner.supervisor"])
    with httpx.Client(trust_env=False) as client:
        for _ in range(60):
            try:
                if client.get("http://127.0.0.1:5108/health").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        else:
            raise RuntimeError("Isolated workload did not start")
    start(
        "api",
        [
            sys.executable,
            "-m",
            "uvicorn",
            "services.api.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8101",
        ],
    )
    with httpx.Client(trust_env=False) as client:
        for _ in range(60):
            try:
                response = client.get("http://127.0.0.1:8101/api/v1/services")
                if response.status_code == 200 and response.json():
                    break
            except (httpx.HTTPError, ValueError):
                pass
            time.sleep(0.25)
        else:
            raise RuntimeError("Isolated API did not start")
    start("worker", [sys.executable, "-m", "services.monitor_worker.worker"])
    while True:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("A test-stack process exited; inspect .logs/e2e")
        time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    for process in reversed(processes):
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    for handle in handles:
        handle.close()
    directory.cleanup()
