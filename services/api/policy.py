from services.api.http_client import internal_client
from datetime import datetime, timezone
from typing import Tuple, Optional
import httpx
from services.api.config import settings
from services.api.models import Incident, Service
from services.api.schemas import AIAnalysisResult

# Strict hardcoded runbook allowlist
ALLOWLISTED_RUNBOOKS = {
    "RESTART_DEMO_CHILD_SERVICE": {
        "description": "Restarts the supervised demo child service on internal port 5006",
        "allowed_targets": ["demo-service"],
        "auto_recover_allowed": True,
        "cooldown_seconds": 60,
        "endpoint": "/internal/v1/runbooks/restart-demo-child",
    },
    "REPLAY_DEMO_ATTENDANCE_QUEUE": {
        "description": "Processes the bounded synthetic attendance queue without restarting",
        "allowed_targets": ["demo-service"],
        "auto_recover_allowed": True,
        "cooldown_seconds": 60,
        "endpoint": "/internal/v1/runbooks/replay-attendance-queue",
    },
}


class PolicyDecision:
    def __init__(
        self,
        allowed: bool,
        auto_recover: bool,
        runbook_id: Optional[str],
        state_transition: str,
        reason: str,
    ):
        self.allowed = allowed
        self.auto_recover = auto_recover
        self.runbook_id = runbook_id
        self.state_transition = state_transition
        self.reason = reason


def evidence_allows_runbook(runbook_id: str, last_error: str | None) -> bool:
    err = (last_error or "").lower()
    if any(
        marker in err
        for marker in (
            "degraded",
            "pool",
            "deadlock",
            "http_500",
            '"error_type":"database',
        )
    ):
        return False
    return (
        runbook_id == "REPLAY_DEMO_ATTENDANCE_QUEUE"
        and "attendance_queue_backlog" in err
    ) or (
        runbook_id == "RESTART_DEMO_CHILD_SERVICE"
        and any(
            marker in err for marker in ("connection refused", "timed out", "timeout")
        )
    )


def evaluate_incident_policy(
    incident: Incident, service: Service, analysis: AIAnalysisResult
) -> PolicyDecision:
    """
    Deterministic Policy Engine.
    Evaluates incident evidence and AI recommendations against rigid security guardrails.
    AI suggestions cannot bypass this check.
    """
    now = datetime.now(timezone.utc)

    # 1. Check if the incident is already resolved or closed
    if incident.state in ["RESOLVED", "CLOSED"]:
        return PolicyDecision(
            allowed=False,
            auto_recover=False,
            runbook_id=None,
            state_transition=incident.state,
            reason="Incident is already concluded.",
        )

    # 2. Check cooldown window
    cooldown = incident.auto_recovery_cooldown_until
    if cooldown and cooldown.tzinfo is None:
        cooldown = cooldown.replace(tzinfo=timezone.utc)
    if cooldown and cooldown > now:
        remaining = int((cooldown - now).total_seconds())
        return PolicyDecision(
            allowed=False,
            auto_recover=False,
            runbook_id=None,
            state_transition="ESCALATED",
            reason=f"Service recovery cooldown in effect for another {remaining} seconds. Bounded safety stop.",
        )

    # 3. Check max recovery attempts (max 1 automatic recovery per incident)
    if incident.auto_recovery_attempted:
        return PolicyDecision(
            allowed=False,
            auto_recover=False,
            runbook_id=None,
            state_transition="ESCALATED",
            reason="Maximum automated recovery attempts (1) reached for this incident. Escalated to prevent restart loops.",
        )

    # 4. Scenario B check: Degraded or unknown application state
    err = (incident.last_error or "").lower()
    if (
        "500" in err
        or "degraded" in err
        or "pool" in err
        or "deadlock" in err
        or analysis.requires_human_review
    ):
        return PolicyDecision(
            allowed=False,
            auto_recover=False,
            runbook_id=None,
            state_transition="AWAITING_APPROVAL",
            reason="The recorded fault requires human review. No automated recovery is authorized for this evidence.",
        )

    # 5. Evaluate recommended runbook against rigid allowlist
    rec_runbook = analysis.recommended_runbook_id
    evidence_matches = evidence_allows_runbook(rec_runbook, incident.last_error)
    if not evidence_matches:
        return PolicyDecision(
            False,
            False,
            None,
            "AWAITING_APPROVAL",
            "Evidence does not support the recommended recovery action. Human review is required.",
        )

    rec_runbook = analysis.recommended_runbook_id
    if not rec_runbook or rec_runbook not in ALLOWLISTED_RUNBOOKS:
        return PolicyDecision(
            allowed=False,
            auto_recover=False,
            runbook_id=None,
            state_transition="ESCALATED",
            reason=f"Recommended action '{rec_runbook}' is not in the approved safety allowlist.",
        )

    runbook_meta = ALLOWLISTED_RUNBOOKS[rec_runbook]

    # 6. Verify target service slug is permitted for this runbook
    if service.slug not in runbook_meta["allowed_targets"]:
        return PolicyDecision(
            allowed=False,
            auto_recover=False,
            runbook_id=None,
            state_transition="ESCALATED",
            reason=f"Service '{service.slug}' is not permitted for runbook '{rec_runbook}'.",
        )

    # 7. Safe Scenario A: Allowlisted restart permitted
    return PolicyDecision(
        allowed=True,
        auto_recover=True,
        runbook_id=rec_runbook,
        state_transition="RECOVERING",
        reason=f"Recorded evidence matches the allowlisted runbook {rec_runbook}. Bounded recovery approved.",
    )


async def execute_runbook(
    runbook_id: str,
    incident_id: str,
    idempotency_key: str,
    actor_id: str = "system_policy",
) -> Tuple[bool, str]:
    """
    Executes an approved allowlisted runbook against the isolated sandbox supervisor.
    """
    if runbook_id not in ALLOWLISTED_RUNBOOKS:
        return False, f"Runbook {runbook_id} is not allowlisted."

    runbook_meta = ALLOWLISTED_RUNBOOKS[runbook_id]
    target_endpoint = f"{settings.RUNNER_CONTROL_URL}{runbook_meta['endpoint']}"

    headers = {
        "X-Runner-Token": settings.RUNNER_AUTH_TOKEN,
        "X-Idempotency-Key": idempotency_key,
    }

    try:
        async with internal_client(timeout=10.0) as client:
            resp = await client.post(target_endpoint, headers=headers, timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                return True, data.get("message", "Runbook executed successfully")
            else:
                return False, f"Runner returned HTTP {resp.status_code}: {resp.text}"
    except Exception as e:
        return False, f"Failed to communicate with runner supervisor: {str(e)}"
