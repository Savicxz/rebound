import pytest
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from services.api.analyzer import (
    DeterministicDemoAnalyzer,
    EnterpriseIncidentAnalyzer,
    GeminiIncidentAnalyzer,
    sanitize_logs,
)
from services.api.config import Settings
from services.api.models import Incident, Service
from services.api.policy import evaluate_incident_policy


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,restart",
    [
        (None, False),
        ("Unrecognised TLS failure", False),
        ("HTTP 500", False),
        ("Connection refused", True),
        ("Request timed out after 2s", True),
    ],
)
async def test_only_connection_failures_qualify_for_restart(error, restart):
    result = await DeterministicDemoAnalyzer().analyze(
        "incident", "Demo", [{"id": "probe"}], error
    )
    assert bool(result.recommended_runbook_id) == restart
    assert result.requires_human_review is not restart
    assert result.evidence_event_ids == ["probe"]
    result.requires_human_review = False
    result.recommended_runbook_id = "RESTART_DEMO_CHILD_SERVICE"
    decision = evaluate_incident_policy(
        Incident(state="OPEN", last_error=error), Service(slug="demo-service"), result
    )
    assert decision.auto_recover is restart


@pytest.mark.asyncio
async def test_unavailable_providers_are_labelled():
    for analyzer in (
        GeminiIncidentAnalyzer(""),
        EnterpriseIncidentAnalyzer("https://unimplemented.example"),
    ):
        result = await analyzer.analyze("incident", "Demo", [], "Connection refused")
        assert result.provider == "demo_fallback"
        assert result.fallback_reason


@pytest.mark.asyncio
async def test_queue_evidence_cannot_authorize_restart_and_replay_is_specific():
    analysis = await DeterministicDemoAnalyzer().analyze(
        "incident", "Attendance", [], "ATTENDANCE_QUEUE_BACKLOG"
    )
    incident = Incident(state="OPEN", last_error="ATTENDANCE_QUEUE_BACKLOG")
    service = Service(slug="demo-service")
    assert evaluate_incident_policy(incident, service, analysis).auto_recover
    analysis.recommended_runbook_id = "RESTART_DEMO_CHILD_SERVICE"
    assert not evaluate_incident_policy(incident, service, analysis).auto_recover
    incident.last_error = "Connection refused"
    analysis.recommended_runbook_id = "REPLAY_DEMO_ATTENDANCE_QUEUE"
    assert not evaluate_incident_policy(incident, service, analysis).auto_recover


def test_synthetic_queue_replay_does_not_duplicate_records():
    from fastapi.testclient import TestClient
    from services.sandbox_runner.child_service import app, processed_attendance

    with TestClient(app) as client:
        assert (
            client.post("/internal/set-mode?mode=attendance_backlog").status_code == 200
        )
        health = client.get("/health")
        assert health.status_code == 429 and health.json()["queued_records"] == 12
        first = client.post("/internal/replay-attendance").json()
        assert first["processed"] == 12 and first["remaining"] == 0
        assert client.post("/internal/replay-attendance").json()["processed"] == 0
        assert len(processed_attendance) == 12
        assert client.get("/health").status_code == 200


def test_non_demo_mode_rejects_default_secrets():
    with pytest.raises(ValueError, match="unique"):
        Settings(_env_file=None, ENVIRONMENT="production")


def test_sensitive_values_are_redacted():
    assert "hello@example.com" not in sanitize_logs("hello@example.com")
    assert "secret-value" not in sanitize_logs("api_key=secret-value")


@pytest.mark.asyncio
@pytest.mark.parametrize("fails", [False, True])
async def test_gemini_records_the_actual_provider_and_closes_client(monkeypatch, fails):
    from google import genai

    GeminiIncidentAnalyzer._starts.clear()

    async def generate(**kwargs):
        if fails:
            raise RuntimeError("private failure details")
        return SimpleNamespace(
            text=json.dumps(
                {
                    "incident_id": "wrong",
                    "provider": "demo_fallback",
                    "summary": "Connection failure",
                    "suspected_cause": "Process unavailable",
                    "evidence_event_ids": ["probe"],
                    "confidence": "medium",
                    "reasoning_summary": "Review probes",
                    "requires_human_review": False,
                }
            )
        )

    client = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_content=generate, get=AsyncMock()),
            aclose=AsyncMock(),
        ),
        close=Mock(),
    )
    monkeypatch.setattr(genai, "Client", lambda **kwargs: client)
    result = await GeminiIncidentAnalyzer("test-key").analyze(
        "incident", "Demo", [{"id": "probe"}], "Connection refused"
    )
    assert result.provider == ("demo_fallback" if fails else "gemini_api")
    assert result.incident_id == "incident"
    assert result.evidence_event_ids == ["probe"]
    assert "private failure details" not in (result.fallback_reason or "")
    client.aio.aclose.assert_awaited_once()
    client.close.assert_called_once()
