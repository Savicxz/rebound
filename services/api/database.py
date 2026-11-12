import os
from sqlalchemy.pool import NullPool
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from services.api.config import settings

Base = declarative_base()

# SQLite specific connect args if using sqlite
connect_args = (
    {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    **({"poolclass": NullPool} if os.environ.get("REBOUND_TEST_DATABASE_URL") else {})
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# Track flushed changes too: record_event explicitly flushes before its caller commits.
from sqlalchemy import event, update
from sqlalchemy.orm import Session


@event.listens_for(Session, "before_flush")
def track_realtime_changes(session, *_):
    tables = {
        "services",
        "incidents",
        "incident_events",
        "health_observations",
        "ai_analyses",
        "runbook_executions",
        "notifications",
        "settings",
    }
    if any(
        getattr(item, "__tablename__", None) in tables
        for item in session.new | session.dirty | session.deleted
    ):
        session.info["realtime_changed"] = True


@event.listens_for(Session, "before_commit")
def commit_realtime_revision(session):
    session.flush()
    if session.info.pop("realtime_changed", False):
        from services.api.models import RealtimeRevision, get_utc_now

        # Atomic UPDATE serializes watermark writers until commit on both databases.
        session.execute(
            update(RealtimeRevision)
            .where(RealtimeRevision.id == 1)
            .values(revision=RealtimeRevision.revision + 1, changed_at=get_utc_now())
        )


@event.listens_for(Session, "after_rollback")
def clear_realtime_changes(session):
    session.info.pop("realtime_changed", None)
