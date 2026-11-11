import pytest
import json
from types import SimpleNamespace
from unittest.mock import Mock
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

    def generate(**kwargs):
        if fails:
            raise RuntimeError("private failure details")
        return SimpleNamespace(
            text=json.dumps(
                {
                    "incident_id": "wrong",
                    "provider": "demo_fallback",
                    "summary": "Connection failure",
                    "suspected_cause": "Process unavailable",
                    "evidence_event_ids": ["probe", "invented"],
                    "confidence": "medium",
                    "reasoning_summary": "Review probes",
                    "requires_human_review": False,
                }
            )
        )

    client = SimpleNamespace(
        models=SimpleNamespace(generate_content=generate), close=Mock()
    )
    monkeypatch.setattr(genai, "Client", lambda **kwargs: client)
    result = await GeminiIncidentAnalyzer("test-key").analyze(
        "incident", "Demo", [{"id": "probe"}], "Connection refused"
    )
    assert result.provider == ("demo_fallback" if fails else "gemini_api")
    assert result.incident_id == "incident"
    assert result.evidence_event_ids == ["probe"]
    assert "private failure details" not in (result.fallback_reason or "")
    client.close.assert_called_once()
