"""Committed invalidations and bounded incident processing regressions."""

import asyncio
import os
import sys
import json
import time
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import select, func
from services.api.database import AsyncSessionLocal
from services.api.seed import init_database_and_seed
from services.api.models import (
    Service,
    Incident,
    HealthObservation,
    RunbookExecution,
    AIAnalysis,
    get_utc_now,
)
from services.api.events import current_revision, EventBroadcaster
from services.monitor_worker import worker


@pytest.fixture(autouse=True)
async def seeded():
    await init_database_and_seed()


@pytest.mark.asyncio
async def test_revision_is_visible_only_after_commit_and_not_after_rollback():
    before = (await current_revision())["revision"]
    async with AsyncSessionLocal() as session:
        service = (await session.execute(select(Service))).scalars().first()
        service.display_name = "Uncommitted test"
        await session.flush()
        assert (await current_revision())["revision"] == before
        await session.rollback()
        await session.commit()
        assert (await current_revision())["revision"] == before
        service = (await session.execute(select(Service))).scalars().first()
        service.display_name = "Committed test"
        await session.commit()
    assert (await current_revision())["revision"] == before + 1


@pytest.mark.asyncio
async def test_separate_process_commit_reaches_relay_and_coalesces():
    relay = EventBroadcaster()
    queue = await relay.subscribe()
    task = asyncio.create_task(relay.relay())
    try:
        first = await asyncio.wait_for(queue.get(), 2)
        code = """import asyncio
from services.api.database import AsyncSessionLocal, engine
from services.api.models import Service
from sqlalchemy import select
async def change():
    async with AsyncSessionLocal() as session:
        service = (await session.execute(select(Service))).scalars().first()
        service.display_name = "Cross-process commit"
        await session.commit()
    await engine.dispose()
asyncio.run(change())"""
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        output, errors = await process.communicate()
        assert process.returncode == 0, errors.decode()
        update = await asyncio.wait_for(queue.get(), 2)
        assert update["revision"] > first["revision"]
        # Reconnection fetches the committed watermark even when no queue existed.
        assert (await current_revision())["revision"] == update["revision"]
        await asyncio.sleep(0.3)
        assert queue.empty()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        relay.unsubscribe(queue)
        assert not relay.subscribers


async def incident_for_test():
    async with AsyncSessionLocal() as session:
        service = (await session.execute(select(Service))).scalars().first()
        incident = Incident(
            service_id=service.id,
            fingerprint="perf-regression",
            title="Synthetic slow analysis",
            state="OPEN",
            last_error="unknown fault",
            detected_at=get_utc_now(),
        )
        session.add(incident)
        await session.commit()
        return incident.id, service.id


@pytest.mark.asyncio
async def test_slow_analysis_does_not_block_probes_duplicate_claims_or_shutdown(
    monkeypatch,
):
    incident_id, service_id = await incident_for_test()
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    class Slow:
        async def analyze(self, **kwargs):
            nonlocal calls
            calls += 1
            entered.set()
            await release.wait()
            return await worker.DeterministicDemoAnalyzer().analyze(**kwargs)

    monkeypatch.setattr(worker, "get_analyzer", Slow)
    first, second = worker.IncidentProcessor(), worker.IncidentProcessor()
    first.submit(incident_id)
    first.submit(incident_id)
    await asyncio.wait_for(entered.wait(), 2)
    second.submit(incident_id)

    async def healthy(service, client=None):
        return dict(
            service_id=service.id,
            observed_at=get_utc_now(),
            latency_ms=1,
            http_status=200,
            success=True,
            error_type=None,
            sanitized_details="Synthetic healthy probe",
        )

    monkeypatch.setattr(worker, "probe_service", healthy)
    async with AsyncSessionLocal() as session:
        count = await session.scalar(
            select(func.count()).select_from(HealthObservation)
        )
    await asyncio.wait_for(worker.monitor_iteration(first), 2)
    async with AsyncSessionLocal() as session:
        assert (
            await session.scalar(select(func.count()).select_from(HealthObservation))
            > count
        )
    await asyncio.sleep(0.05)
    assert calls == 1
    await first.close()
    await second.close()
    assert not first.tasks and not second.tasks
    async with AsyncSessionLocal() as session:
        assert (await session.get(Incident, incident_id)).state == "ESCALATED"
        assert (
            not (
                await session.execute(
                    select(RunbookExecution).where(
                        RunbookExecution.incident_id == incident_id
                    )
                )
            )
            .scalars()
            .all()
        )


@pytest.mark.asyncio
async def test_timeout_fallback_and_reset_during_analysis(monkeypatch):
    incident_id, _ = await incident_for_test()

    class Slow:
        async def analyze(self, **kwargs):
            await asyncio.sleep(60)

    monkeypatch.setattr(worker, "get_analyzer", Slow)
    monkeypatch.setattr(worker.settings, "ANALYSIS_TIMEOUT_SECONDS", 0.02)
    pool = worker.IncidentProcessor()
    pool.submit(incident_id)
    await asyncio.gather(*list(pool.tasks.values()))
    async with AsyncSessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        assert incident.state == "AWAITING_APPROVAL"
        analysis = (
            (
                await session.execute(
                    select(AIAnalysis).where(AIAnalysis.incident_id == incident_id)
                )
            )
            .scalars()
            .one()
        )
        assert analysis.provider == "demo_fallback"
        assert "TimeoutError" in analysis.error
    await pool.close()
    incident_id, _ = await incident_for_test()
    entered, release = asyncio.Event(), asyncio.Event()

    class Waiting:
        async def analyze(self, **kwargs):
            entered.set()
            await release.wait()
            return await worker.DeterministicDemoAnalyzer().analyze(**kwargs)

    monkeypatch.setattr(worker, "get_analyzer", Waiting)
    monkeypatch.setattr(worker.settings, "ANALYSIS_TIMEOUT_SECONDS", 5)
    pool.submit(incident_id)
    await asyncio.wait_for(entered.wait(), 2)
    async with AsyncSessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        incident.state = "CLOSED"
        await session.commit()
    release.set()
    await asyncio.gather(*list(pool.tasks.values()))
    async with AsyncSessionLocal() as session:
        assert (await session.get(Incident, incident_id)).state == "CLOSED"
        assert (
            not (
                await session.execute(
                    select(AIAnalysis).where(AIAnalysis.incident_id == incident_id)
                )
            )
            .scalars()
            .all()
        )
    await pool.close()


@pytest.mark.asyncio
async def test_bounded_task_pool_and_query_count(monkeypatch):
    pool = worker.IncidentProcessor()
    entered = asyncio.Event()

    async def pending(_):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(pool, "process", pending)
    for index in range(20):
        pool.submit(str(index))
    assert len(pool.tasks) == worker.settings.INCIDENT_CONCURRENCY
    await entered.wait()
    await pool.close()
    assert not pool.tasks
    from services.api.database import engine
    from services.api.main import list_incidents
    from sqlalchemy import event

    queries = []

    def count(connection, cursor, statement, *args):
        queries.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        async with AsyncSessionLocal() as session:
            records = await list_incidents(state=None, limit=50, db=session)
            assert records
            assert len(queries) == 4
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)


@pytest.mark.asyncio
async def test_summary_projection_preserves_default_evidence_and_cursor():
    from services.api.main import list_incidents

    async with AsyncSessionLocal() as session:
        full = await list_incidents(state=None, limit=50, db=session)
        summary = await list_incidents(
            state=None, limit=50, include_evidence=False, db=session
        )
        assert [item.id for item in full] == [item.id for item in summary]
        assert all(
            not item.events
            and not item.runbook_executions
            and item.latest_analysis is None
            for item in summary
        )
        page = await list_incidents(state=None, limit=1, db=session)
        following = await list_incidents(
            state=None, limit=50, before_id=page[-1].id, db=session
        )
        assert page[-1].id not in [item.id for item in following]


@pytest.mark.asyncio
async def test_recovery_claim_is_single_execution_and_interruption_is_not_resolution(
    monkeypatch,
):
    incident_id, _ = await incident_for_test()
    async with AsyncSessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        service = await session.get(Service, incident.service_id)
        # The existing allowlist only permits this isolated target.
        service.slug = "demo-service"
        incident.last_error = "Connection refused"
        await session.commit()
    entered = asyncio.Event()

    async def runner(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    execute = AsyncMock(side_effect=runner)
    monkeypatch.setattr(worker, "execute_runbook", execute)
    first, second = worker.IncidentProcessor(), worker.IncidentProcessor()
    first.submit(incident_id)
    await asyncio.wait_for(entered.wait(), 2)
    second.submit(incident_id)
    await asyncio.gather(*list(second.tasks.values()))
    assert execute.await_count == 1
    await first.close()
    await second.close()
    async with AsyncSessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        assert incident.state == "ESCALATED" and incident.resolved_at is None
        executions = (
            (
                await session.execute(
                    select(RunbookExecution).where(
                        RunbookExecution.incident_id == incident_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(executions) == 1 and executions[0].status == "FAILED"
        assert "unknown" in executions[0].runner_response_redacted


@pytest.mark.asyncio
async def test_concurrent_event_sequences_are_unique():
    incident_id, _ = await incident_for_test()

    async def append(label):
        async with AsyncSessionLocal() as session:
            await worker.record_event(session, incident_id, "SEQUENCE_TEST", label)
            await session.commit()

    await asyncio.gather(append("first"), append("second"))
    from services.api.models import IncidentEvent

    async with AsyncSessionLocal() as session:
        events = (
            (
                await session.execute(
                    select(IncidentEvent)
                    .where(IncidentEvent.incident_id == incident_id)
                    .order_by(IncidentEvent.sequence)
                )
            )
            .scalars()
            .all()
        )
        assert [event.sequence for event in events] == [1, 2]


def test_production_launcher_requires_a_build(monkeypatch, tmp_path):
    import start

    monkeypatch.setattr(start, "WEB", tmp_path)
    monkeypatch.setattr(sys, "argv", ["start.py", "--production-web", "--check"])
    with pytest.raises(RuntimeError, match="Production web build is missing"):
        start.main()
