"""Repeatable isolated API timing/query-count benchmark; never uses the demo DB."""

import os
import sys
import tempfile
import asyncio
import json
import statistics
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def main():
    with tempfile.TemporaryDirectory(prefix="rebound-bench-") as directory:
        os.environ["DATABASE_URL"] = (
            f"sqlite+aiosqlite:///{Path(directory).as_posix()}/bench.db"
        )
        from services.api.database import AsyncSessionLocal, engine
        from services.api.seed import init_database_and_seed
        from services.api.models import Incident, IncidentEvent, Service, get_utc_now
        from services.api.main import get_dashboard, list_incidents
        from sqlalchemy import select, event

        await init_database_and_seed()
        async with AsyncSessionLocal() as session:
            service = (await session.execute(select(Service))).scalars().first()
            for index in range(int(os.environ.get("REBOUND_BENCH_INCIDENTS", "100"))):
                incident = Incident(
                    service_id=service.id,
                    fingerprint=f"bench-{index}",
                    title="Synthetic benchmark",
                    state="CLOSED",
                    detected_at=get_utc_now(),
                )
                session.add(incident)
                await session.flush()
                for sequence in range(1, 4):
                    session.add(
                        IncidentEvent(
                            incident_id=incident.id,
                            sequence=sequence,
                            event_type="BENCHMARK",
                            public_message="Synthetic benchmark record",
                        )
                    )
            await session.commit()
        count = 0

        def query(*args):
            nonlocal count
            count += 1

        event.listen(engine.sync_engine, "before_cursor_execute", query)
        results = {}
        for name, call in (
            ("dashboard", get_dashboard),
            ("incident_list", lambda db: list_incidents(state=None, limit=50, db=db)),
        ):
            samples, queries = [], []
            for _ in range(25):
                async with AsyncSessionLocal() as session:
                    before = count
                    start = time.perf_counter()
                    await call(db=session)
                    samples.append((time.perf_counter() - start) * 1000)
                    queries.append(count - before)
            results[name] = {
                "p50_ms": round(statistics.median(samples), 2),
                "p95_ms": round(sorted(samples)[23], 2),
                "queries": queries[-1],
                "samples": len(samples),
            }
        print(json.dumps(results, indent=2))
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
