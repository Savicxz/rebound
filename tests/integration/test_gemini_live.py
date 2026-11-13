"""Optional real-provider check. Mocked output never establishes live success."""

import pytest


@pytest.mark.asyncio
async def test_live_gemini_analysis(live_gemini_analyzer):
    from services.api.seed import init_database_and_seed

    # conftest isolates the database. This test never executes recovery.
    await init_database_and_seed()
    result = await live_gemini_analyzer.analyze(
        incident_id="live-provider-check",
        service_name="Synthetic integration-test service",
        recent_probes=[
            {
                "id": "live-provider-probe",
                "success": False,
                "http_status": 500,
                "sanitized_details": "Unknown synthetic application fault; cause unconfirmed",
            }
        ],
        last_error="Unknown synthetic application fault; cause unconfirmed",
    )
    assert result.provider == "gemini_api", (
        "Live Gemini analysis did not complete successfully; fallback is not verification."
    )
    assert result.fallback_reason is None
    assert result.investigation["model_available"] is True
    assert result.investigation["completed_at"] is not None
    assert set(result.evidence_event_ids) <= {"live-provider-probe"}
    assert result.requires_human_review is True
    assert result.recommended_runbook_id is None
