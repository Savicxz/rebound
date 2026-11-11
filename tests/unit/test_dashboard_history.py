from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from services.api.database import Base
from services.api.main import get_dashboard
from services.api.config import settings
from services.api.models import AIAnalysis, HealthObservation, Incident, Service


@pytest.mark.asyncio
async def test_dashboard_exposes_bounded_recorded_checks(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            session.add(
                Service(
                    id="demo",
                    slug="demo",
                    display_name="Demo",
                    health_url="http://sandbox/health",
                )
            )
            start = datetime(2026, 11, 10, tzinfo=timezone.utc)
            session.add_all(
                [
                    HealthObservation(
                        id=f"check-{index}",
                        service_id="demo",
                        observed_at=start + timedelta(seconds=index),
                        latency_ms=float(index),
                        success=index % 2 == 0,
                        http_status=200 if index % 2 == 0 else 500,
                    )
                    for index in range(125)
                ]
            )
            await session.commit()
            result = await get_dashboard(session)
            assert len(result.recent_observations) == 120
            assert result.recent_observations[0].id == "check-124"
            assert result.recent_observations[-1].id == "check-5"
            assert result.recent_observations[0].latency_ms == 124
            assert result.recent_observations[1].success is False
            assert result.metrics.gemini_status == "not_configured"
            monkeypatch.setattr(settings, "GEMINI_API_KEY", "configured-test-key")
            assert (await get_dashboard(session)).metrics.gemini_status == "configured"
            session.add(
                Incident(
                    id="incident",
                    service_id="demo",
                    fingerprint="test",
                    title="Test",
                    state="CLOSED",
                )
            )
            analysis = AIAnalysis(
                incident_id="incident",
                provider="demo_fallback",
                schema_version="1.0",
                result_json="{}",
                model_id="test-model",
            )
            session.add(analysis)
            await session.commit()
            assert (await get_dashboard(session)).metrics.gemini_status == "fallback"
            analysis.provider = "gemini_api"
            await session.commit()
            assert (await get_dashboard(session)).metrics.gemini_status == "verified"
    finally:
        await engine.dispose()
