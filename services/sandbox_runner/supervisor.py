"""
Rebound Sandbox Supervisor Service
Runs on internal private port (RUNNER_CONTROL_PORT, default 5005).
Supervises the isolated child service on RUNNER_DEMO_PORT (default 5006).

Security guarantees:
- Dedicated private network binding.
- Mandatory X-Runner-Token header authentication matching RUNNER_AUTH_TOKEN.
- Fixed invocation targets only: no shell=True, no arbitrary process names, no parameter injection.
"""

import os
import sys
import subprocess
import time
import httpx
from fastapi import FastAPI, Header, HTTPException, status, Depends
import uvicorn

RUNNER_AUTH_TOKEN = os.getenv(
    "RUNNER_AUTH_TOKEN", "rebound_runner_internal_token_secure_2026"
)
RUNNER_CONTROL_PORT = int(os.getenv("RUNNER_CONTROL_PORT", "5005"))
RUNNER_DEMO_PORT = int(os.getenv("RUNNER_DEMO_PORT", "5006"))

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Supervisor] Starting up. Launching initial child service...")
    start_child_process("normal")
    yield
    print("[Supervisor] Shutting down. Stopping child service...")
    stop_child_process()


app = FastAPI(title="Rebound Sandbox Supervisor (Internal Control)", lifespan=lifespan)


class SupervisorState:
    def __init__(self):
        self.child_process = None
        self.mode = "normal"
        self.restart_count = 0
        self.last_action = "init"
        self.last_action_timestamp = time.time()


state = SupervisorState()


def verify_runner_auth(x_runner_token: str = Header(None, alias="X-Runner-Token")):
    if not x_runner_token or x_runner_token != RUNNER_AUTH_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid or missing X-Runner-Token",
        )
    return True


def start_child_process(mode: str = "normal"):
    # Kill any existing process first
    stop_child_process()

    script_path = os.path.join(os.path.dirname(__file__), "child_service.py")
    cmd = [
        sys.executable,
        script_path,
        "--port",
        str(RUNNER_DEMO_PORT),
        "--mode",
        mode,
        "--host",
        os.getenv("RUNNER_BIND_HOST", "127.0.0.1"),
    ]

    # Launch subprocess directly without shell injection
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    state.child_process = proc
    state.mode = mode
    state.last_action_timestamp = time.time()
    return proc.pid


def stop_child_process():
    if state.child_process:
        pid = state.child_process.pid
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                state.child_process.terminate()
                state.child_process.wait(timeout=2)
        except Exception:
            try:
                state.child_process.kill()
            except Exception:
                pass
        state.child_process = None


@app.get("/internal/v1/runner-status")
def runner_status(_: bool = Depends(verify_runner_auth)):
    is_running = False
    pid = None
    if state.child_process:
        poll_res = state.child_process.poll()
        if poll_res is None:
            is_running = True
            pid = state.child_process.pid
        else:
            state.child_process = None

    return {
        "status": "ok",
        "child_running": is_running,
        "child_pid": pid,
        "mode": state.mode,
        "restart_count": state.restart_count,
        "last_action": state.last_action,
        "last_action_timestamp": state.last_action_timestamp,
        "demo_service_port": RUNNER_DEMO_PORT,
    }


@app.post("/internal/v1/scenario/crash")
def scenario_crash(_: bool = Depends(verify_runner_auth)):
    """Simulates a hard process crash by terminating the child process."""
    if not state.child_process or state.child_process.poll() is not None:
        return {
            "status": "ok",
            "message": "Child process is already stopped",
            "child_running": False,
        }

    pid = state.child_process.pid
    stop_child_process()
    state.mode = "crashed"
    state.last_action = "crash_simulated"
    state.last_action_timestamp = time.time()

    return {
        "status": "ok",
        "action": "CRASH_EXECUTED",
        "message": f"Successfully stopped supervised child process PID {pid}",
        "child_running": False,
    }


@app.post("/internal/v1/scenario/degrade")
@app.post("/internal/v1/scenario/degraded")
def scenario_degrade(_: bool = Depends(verify_runner_auth)):
    """Simulates degraded / inconsistent service state."""
    if state.child_process and state.child_process.poll() is None:
        try:
            r = httpx.post(
                f"http://127.0.0.1:{RUNNER_DEMO_PORT}/internal/set-mode?mode=degraded",
                timeout=2.0,
            )
            if r.status_code == 200:
                state.mode = "degraded"
                state.last_action = "degrade_simulated"
                state.last_action_timestamp = time.time()
                return {
                    "status": "ok",
                    "action": "DEGRADE_EXECUTED",
                    "message": "Supervised child service switched to DEGRADED mode (HTTP 500 database pool deadlock)",
                    "child_running": True,
                }
        except Exception:
            pass

    start_child_process("degraded")
    state.mode = "degraded"
    state.last_action = "degrade_simulated"
    state.last_action_timestamp = time.time()

    return {
        "status": "ok",
        "action": "DEGRADE_EXECUTED",
        "message": "Supervised child service is now running in DEGRADED mode (HTTP 500 database pool deadlock)",
        "child_running": True,
    }


@app.post("/internal/v1/runbooks/restart-demo-child")
def restart_demo_child(_: bool = Depends(verify_runner_auth)):
    """
    Allowlisted recovery action: Restarts the single predefined child service in normal mode.
    Hardcoded logic only. Rejects any custom commands or arguments.
    """
    start_child_process("normal")
    time.sleep(0.5)
    state.restart_count += 1
    state.last_action = "restart_executed"
    state.last_action_timestamp = time.time()

    return {
        "status": "ok",
        "action": "RESTART_DEMO_CHILD_EXECUTED",
        "message": f"Supervised child service restarted successfully (PID {state.child_process.pid})",
        "child_pid": state.child_process.pid,
        "restart_count": state.restart_count,
    }


@app.post("/internal/v1/scenario/reset")
def scenario_reset(_: bool = Depends(verify_runner_auth)):
    """Resets the supervisor state and restarts the child service cleanly."""
    if state.child_process and state.child_process.poll() is None:
        try:
            r = httpx.post(
                f"http://127.0.0.1:{RUNNER_DEMO_PORT}/internal/set-mode?mode=normal",
                timeout=2.0,
            )
            if r.status_code == 200:
                state.mode = "normal"
                state.last_action = "reset_executed"
                state.last_action_timestamp = time.time()
                return {
                    "status": "ok",
                    "action": "RESET_EXECUTED",
                    "message": "Demo sandbox reset to pristine healthy state",
                    "child_pid": state.child_process.pid,
                    "mode": "normal",
                }
        except Exception:
            pass

    start_child_process("normal")
    time.sleep(0.5)
    state.mode = "normal"
    state.last_action = "reset_executed"
    state.last_action_timestamp = time.time()

    return {
        "status": "ok",
        "action": "RESET_EXECUTED",
        "message": "Demo sandbox reset to pristine healthy state",
        "child_pid": state.child_process.pid if state.child_process else None,
        "mode": "normal",
    }


if __name__ == "__main__":
    print(
        f"[Supervisor] Launching supervisor control API on 0.0.0.0:{RUNNER_CONTROL_PORT}..."
    )
    uvicorn.run(
        app,
        host=os.getenv("RUNNER_BIND_HOST", "127.0.0.1"),
        port=RUNNER_CONTROL_PORT,
        log_level="info",
    )
