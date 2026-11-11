"""
Rebound — Single-Command Scenario Verification Script
Runs end-to-end verification of both mandatory hackathon scenarios:
- Scenario A: Safe Auto-Recovery on Process Crash
- Scenario B: Degraded Service Policy Escalation
"""

import sys
import time
import httpx

API_BASE = "http://localhost:8000"
RUNNER_CONTROL = "http://localhost:5005"
DEMO_SERVICE = "http://localhost:5006"
RUNNER_AUTH_TOKEN = "rebound_runner_internal_token_secure_2026"

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


def log_step(step: str, title: str):
    print(f"\n{BOLD}{CYAN}=== [{step}] {title} ==={RESET}")


def assert_check(desc: str, condition: bool):
    if condition:
        print(f"  {GREEN}[PASS]{RESET} {desc}")
    else:
        print(f"  {RED}[FAIL]{RESET} {desc}")
        sys.exit(1)


def run_verification():
    print(f"{BOLD}============================================================")
    print(" Rebound — Autonomous IT Self-Healing Verification Suite")
    print(f"============================================================{RESET}")

    # Check services reachability
    log_step("STEP 0", "Verifying Services Availability")
    try:
        r = httpx.get(f"{API_BASE}/api/v1/health", timeout=3.0)
        assert_check(
            "Backend API is Healthy (GET /api/v1/health)", r.status_code == 200
        )
    except Exception as e:
        assert_check(f"Backend API is reachable at {API_BASE}: {e}", False)

    try:
        r = httpx.get(
            f"{RUNNER_CONTROL}/internal/v1/runner-status",
            headers={"X-Runner-Token": RUNNER_AUTH_TOKEN},
            timeout=3.0,
        )
        assert_check("Sandbox Supervisor is running (port 5005)", r.status_code == 200)
    except Exception as e:
        assert_check(f"Sandbox Supervisor reachable at {RUNNER_CONTROL}: {e}", False)

    try:
        r = httpx.get(f"{DEMO_SERVICE}/health", timeout=3.0)
        assert_check(
            "Child Demo Service is Healthy (port 5006)",
            r.status_code == 200 and r.json().get("status") == "healthy",
        )
    except Exception as e:
        assert_check(f"Child Demo Service reachable at {DEMO_SERVICE}: {e}", False)

    # Authenticate
    log_step("STEP 1", "Operator & Admin Authentication")
    r = httpx.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"username": "operator", "password": "OperatorPassword2026!"},
    )
    assert_check("Operator Login Succeeded (200 OK)", r.status_code == 200)
    op_token = r.json()["access_token"]
    op_headers = {"Authorization": f"Bearer {op_token}"}

    r = httpx.post(
        f"{API_BASE}/api/v1/auth/login",
        json={"username": "admin", "password": "AdminPassword2026!"},
    )
    assert_check("Admin Login Succeeded (200 OK)", r.status_code == 200)

    # Reset demo
    log_step("STEP 2", "Demo State Initialization (Prism Reset)")
    r = httpx.post(f"{API_BASE}/api/v1/demo/reset", headers=op_headers)
    assert_check("POST /api/v1/demo/reset executed cleanly", r.status_code == 200)
    time.sleep(1.0)

    # SCENARIO A
    log_step(
        "SCENARIO A",
        "Simulate Process Crash -> Auto-Detection -> Allowlisted Recovery -> Verification",
    )
    crash_res = httpx.post(
        f"{API_BASE}/api/v1/demo/failures", json={"type": "crash"}, headers=op_headers
    )
    assert_check("Triggered Service Crash via API", crash_res.status_code == 200)

    # Verify process is actually dead
    try:
        httpx.get(f"{DEMO_SERVICE}/health", timeout=1.0)
        assert_check("Real child process terminated", False)
    except Exception:
        assert_check(
            "Real child process is genuinely unreachable (Connection Refused)", True
        )

    print(
        "  Waiting for Monitor Worker to detect outage, analyze with AI, execute runbook, and verify..."
    )
    verified = False
    for i in range(15):
        time.sleep(3.0)
        dash = httpx.get(f"{API_BASE}/api/v1/dashboard").json()
        active = dash.get("active_incident")
        print(
            f"    [Iteration {i + 1}] Service Status: {dash['services'][0]['status']} | Incident State: {active.get('state') if active else 'None'}"
        )
        if active and active.get("state") == "RESOLVED":
            verified = True
            break
        elif not active and dash["services"][0]["status"] == "HEALTHY":
            verified = True
            break

    assert_check(
        "Scenario A: Child service automatically recovered and verified healthy",
        verified,
    )

    # SCENARIO B
    log_step(
        "SCENARIO B",
        "Simulate Degraded Service (HTTP 500) -> Guardrail Escalation -> Human Review Required",
    )
    # Reset first
    httpx.post(f"{API_BASE}/api/v1/demo/reset", headers=op_headers)
    time.sleep(1.0)

    degrade_res = httpx.post(
        f"{API_BASE}/api/v1/demo/failures",
        json={"type": "degraded"},
        headers=op_headers,
    )
    assert_check(
        "Triggered Degraded Fault (HTTP 500) via API", degrade_res.status_code == 200
    )

    print(
        "  Waiting for Monitor Worker to detect degraded state and engage deterministic guardrails..."
    )
    escalated = False
    for i in range(12):
        time.sleep(3.0)
        dash = httpx.get(f"{API_BASE}/api/v1/dashboard").json()
        active = dash.get("active_incident")
        if active:
            st = active.get("state")
            print(
                f"    [Iteration {i + 1}] Incident State: {st} | Auto-recovery attempted: {active.get('auto_recovery_attempted')}"
            )
            if st in ["AWAITING_APPROVAL", "ESCALATED"]:
                assert_check(
                    "Scenario B: Automated recovery correctly DECLINED (Requires Human Review)",
                    active.get("auto_recovery_attempted") is False,
                )
                escalated = True
                break

    assert_check(
        "Scenario B: Safety guardrail successfully halted unauthorized auto-recovery",
        escalated,
    )

    # Reset back to pristine state
    log_step("TEARDOWN", "Restoring Sandbox to Pristine State")
    httpx.post(f"{API_BASE}/api/v1/demo/reset", headers=op_headers)
    time.sleep(1.0)
    final_health = httpx.get(f"{DEMO_SERVICE}/health").json()
    assert_check(
        "Child Service Restored to Normal Mode", final_health.get("status") == "healthy"
    )

    print(f"\n{BOLD}{GREEN}ALL END-TO-END SCENARIOS VERIFIED SUCCESSFULLY!{RESET}\n")


if __name__ == "__main__":
    run_verification()
