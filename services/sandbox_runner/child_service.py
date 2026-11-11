"""
Supervised Child Service for Rebound Demonstration
Runs a synthetic HTTP service for recovery testing.
Runs on RUNNER_DEMO_PORT (default: 5006).

It has no connection to production infrastructure.
"""

import argparse
import time
from fastapi import FastAPI, Response, status
import uvicorn

app = FastAPI(title="Demo API Service (Simulated)")

start_time = time.time()
current_mode = "normal"  # "normal" | "degraded"


@app.get("/health")
def health(response: Response):
    uptime = time.time() - start_time
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


@app.post("/internal/set-mode")
def set_mode(mode: str):
    global current_mode
    if mode in ["normal", "degraded"]:
        current_mode = mode
        return {"status": "ok", "mode": current_mode}
    return {"status": "error", "message": "Invalid mode"}, 400


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

    current_mode = args.mode
    print(
        f"[ChildService] Starting Demo API Service on port {args.port} in mode '{current_mode}'..."
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
