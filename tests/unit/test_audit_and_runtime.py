from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from services.api.database import Base
from services.api.main import app, get_demo_runtime, list_audit_events
from services.api.models import Incident, IncidentEvent, Service


@pytest.mark.asyncio
@pytest.mark.parametrize("environment,enabled", [("production", True), ("demo", False)])
async def test_quick_demo_access_requires_enabled_demo_environment(
    monkeypatch, environment, enabled
):
    from services.api.config import settings

    monkeypatch.setattr(settings, "ENVIRONMENT", environment)
    monkeypatch.setattr(settings, "LOCAL_DEMO_ACCESS", enabled)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 1234)),
        base_url="http://localhost:3000",
    ) as client:
        response = await client.post(
            "/api/v1/auth/demo", headers={"Origin": "http://localhost:3000"}
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_failed_reset_preserves_incident_records():
    from services.api.main import reset_demo
    from types import SimpleNamespace

    db = AsyncMock()
    with patch("services.api.main.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value.post.side_effect = (
            httpx.ConnectError("unavailable")
        )
        with pytest.raises(HTTPException) as error:
            await reset_demo(current_user=SimpleNamespace(username="demo"), db=db)
    assert error.value.status_code == 503
    db.execute.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_audit_cursor_preserves_equal_timestamp_events():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            session.add(
                Service(
                    id="service",
                    slug="service",
                    display_name="Demo",
                    health_url="http://sandbox/health",
                )
            )
            session.add(
                Incident(
                    id="incident",
                    service_id="service",
                    fingerprint="demo",
                    title="Demo",
                )
            )
            for index in range(5):
                session.add(
                    IncidentEvent(
                        id=f"event-{index}",
                        incident_id="incident",
                        sequence=index,
                        event_type="PROBE",
                        actor_type="SYSTEM",
                        actor_id="monitor",
                        public_message="Complete evidence",
                        at=datetime(2026, 11, 11, tzinfo=timezone.utc),
                    )
                )
            await session.commit()
            first = await list_audit_events(limit=2, before_id=None, db=session)
            second = await list_audit_events(
                limit=2, before_id=first["next_cursor"], db=session
            )
            third = await list_audit_events(
                limit=2, before_id=second["next_cursor"], db=session
            )
            ids = [
                event.id for page in (first, second, third) for event in page["events"]
            ]
            assert ids == [f"event-{index}" for index in range(4, -1, -1)]
            assert third["next_cursor"] is None
            with pytest.raises(HTTPException) as error:
                await list_audit_events(limit=2, before_id="missing", db=session)
            assert error.value.status_code == 404
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_runtime_exposes_observed_process_fields_only():
    response = httpx.Response(
        200,
        request=httpx.Request("GET", "http://runner/status"),
        json={
            "child_running": True,
            "child_pid": 123,
            "restart_count": 2,
            "mode": "normal",
            "private_secret": "must-not-leak",
        },
    )
    client = AsyncMock()
    client.get.return_value = response
    with patch("services.api.main.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        result = await get_demo_runtime(current_user=Mock())
    assert result["child_pid"] == 123
    assert result["restart_count"] == 2
    assert "observed_at" in result
    assert "private_secret" not in result


@pytest.mark.asyncio
async def test_runtime_failure_is_not_a_fake_success():
    client = AsyncMock()
    client.get.side_effect = httpx.ConnectError("private runner location")
    with patch("services.api.main.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        with pytest.raises(HTTPException) as error:
            await get_demo_runtime(current_user=Mock())
    assert error.value.status_code == 503
    assert "private runner location" not in error.value.detail


@pytest.mark.asyncio
async def test_runtime_requires_sign_in():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/demo/runtime")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_missing_runner_state_is_unverified():
    client = AsyncMock()
    client.get.return_value = httpx.Response(
        200, request=httpx.Request("GET", "http://runner/status"), json={}
    )
    with patch("services.api.main.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        with pytest.raises(HTTPException) as error:
            await get_demo_runtime(current_user=Mock())
    assert error.value.status_code == 503
