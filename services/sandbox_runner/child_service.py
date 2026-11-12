"""
Supervised Child Service for Rebound Demonstration
Runs a synthetic HTTP service for recovery testing.
Runs on RUNNER_DEMO_PORT (default: 5006).

It has no connection to production infrastructure.
"""

import argparse
import time
from fastapi import FastAPI, Response, status, HTTPException
from services.demo_scenarios import SCENARIOS
import uvicorn

app = FastAPI(title="Demo API Service (Simulated)")

start_time = time.time()
current_mode = "normal"  # "normal" | "degraded"
attendance_queue = []
processed_attendance = set()


@app.get("/health")
def health(response: Response):
    uptime = time.time() - start_time
    if current_mode == "slow_assessment":
        time.sleep(0.8)
    if current_mode in SCENARIOS and current_mode not in (
        "crash",
        "degraded",
        "slow_assessment",
    ):
        scenario = SCENARIOS[current_mode]
        response.status_code = scenario["http_status"]
        return {
            "status": "backlog"
            if current_mode == "attendance_backlog"
            else "dependency_failure",
            "error_type": scenario["error_code"],
            "message": scenario["fault"],
            "signals": scenario.get("signals", []),
            "owner": scenario.get("owner"),
            "queued_records": len(attendance_queue),
            "simulated": True,
        }
    if current_mode == "degraded":
        response.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
        return {
            "status": "degraded",
            "service": "demo-service",
            "uptime_seconds": round(uptime, 2),
            "error_type": "DATABASE_POOL_EXHAUSTED",
            "message": "CRITICAL: Connection pool exhausted; 48 worker threads deadlocked waiting on auth_db replica",
            "simulated": True,
        }
    return {
        "status": "healthy",
        "service": "demo-service",
        "version": "1.0.4-synthetic",
        "uptime_seconds": round(uptime, 2),
        "simulated": True,
    }


@app.get("/api/v1/demo/info")
def info():
    return {
        "service_name": "Demo API Service",
        "category": "Demo HTTP service",
        "simulated": True,
        "mode": current_mode,
        "notice": "Synthetic workload for incident recovery tests. No production systems are connected.",
    }


@app.get("/api/v1/demo/workflow")
def workflow(response: Response):
    result = health(response)
    if response.status_code and response.status_code >= 400:
        return result
    return {
        "simulated": True,
        "status": "available",
        "mode": current_mode,
        "message": "Synthetic school service request completed.",
        "attendance": {
            "pending": len(attendance_queue),
            "processed": len(processed_attendance),
        },
    }


@app.post("/internal/set-mode")
def set_mode(mode: str):
    global current_mode
    if mode == "normal" or mode in SCENARIOS and mode != "crash":
        current_mode = mode
        attendance_queue.clear()
        processed_attendance.clear()
        if mode == "attendance_backlog":
            attendance_queue.extend(
                f"synthetic-attendance-{index}" for index in range(12)
            )
        return {"status": "ok", "mode": current_mode}
    raise HTTPException(status_code=400, detail="Invalid mode")


@app.post("/internal/replay-attendance")
def replay_attendance():
    global current_mode
    if current_mode not in ("attendance_backlog", "normal"):
        response = Response(status_code=409)
        return response
    processed = 0
    while attendance_queue:
        record = attendance_queue.pop(0)
        if record not in processed_attendance:
            processed_attendance.add(record)
            processed += 1
    current_mode = "normal"
    return {
        "processed": processed,
        "remaining": len(attendance_queue),
        "simulated": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Demo Child Service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--port", type=int, default=5006, help="Port to run child service on"
    )
    parser.add_argument(
        "--mode", type=str, default="normal", help="Initial mode (normal|degraded)"
    )
    args = parser.parse_args()

    set_mode(args.mode)
    print(
        f"[ChildService] Starting Demo API Service on port {args.port} in mode '{current_mode}'..."
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
