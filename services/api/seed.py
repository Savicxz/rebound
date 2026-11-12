import json
import logging
from sqlalchemy.future import select
from sqlalchemy import and_, or_
from services.api.config import settings
from services.api.database import AsyncSessionLocal, engine, Base
from services.api.models import User, Service, Setting, RealtimeRevision, get_utc_now
from services.api.security import hash_password

logger = logging.getLogger("rebound.seed")


async def init_database_and_seed():
    """Initializes tables and seeds initial demo services and accounts."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all does not add indexes to already-existing tables.
        for table in Base.metadata.sorted_tables:
            for index in table.indexes:
                await conn.run_sync(
                    lambda sync, index=index: index.create(sync, checkfirst=True)
                )
        from sqlalchemy import text

        await conn.execute(
            text(
                "INSERT INTO realtime_revision (id, revision, changed_at) VALUES (1, 0, CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING"
            )
        )

    async with AsyncSessionLocal() as session:
        # 1. Seed demo users
        admin_q = select(User).where(User.username == settings.ADMIN_USERNAME)
        res = await session.execute(admin_q)
        admin = res.scalars().first()
        if not admin:
            admin = User(
                username=settings.ADMIN_USERNAME,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                role="ADMIN",
                created_at=get_utc_now(),
            )
            session.add(admin)
            logger.info(f"Seeded admin user: {settings.ADMIN_USERNAME}")

        operator_q = select(User).where(User.username == settings.OPERATOR_USERNAME)
        res = await session.execute(operator_q)
        operator = res.scalars().first()
        if not operator:
            operator = User(
                username=settings.OPERATOR_USERNAME,
                password_hash=hash_password(settings.OPERATOR_PASSWORD),
                role="OPERATOR",
                created_at=get_utc_now(),
            )
            session.add(operator)
            logger.info(f"Seeded operator user: {settings.OPERATOR_USERNAME}")

        # 2. Seed primary demo service
        health_url = f"{settings.RUNNER_DEMO_SERVICE_URL}/health"
        svc_q = select(Service).where(
            or_(
                Service.slug == "demo-service",
                and_(Service.is_demo.is_(True), Service.health_url == health_url),
            )
        )
        res = await session.execute(svc_q)
        service = res.scalars().first()
        if service:
            service.slug = "demo-service"
            service.display_name = "Demo API Service"
            service.service_type = "Demo HTTP Service (Simulated)"
        if not service:
            service = Service(
                slug="demo-service",
                display_name="Demo API Service",
                service_type="Demo HTTP Service (Simulated)",
                is_demo=True,
                status="HEALTHY",
                health_url=f"{settings.RUNNER_DEMO_SERVICE_URL}/health",
                consecutive_failures=0,
                consecutive_successes=0,
                created_at=get_utc_now(),
            )
            session.add(service)
            logger.info("Seeded primary demo service: Demo API Service")

        # 3. Seed initial settings
        setting_q = select(Setting).where(Setting.key == "platform_config")
        res = await session.execute(setting_q)
        existing_setting = res.scalars().first()
        if not existing_setting:
            init_config = {
                "health_interval": settings.HEALTH_CHECK_INTERVAL_SECONDS,
                "health_timeout": settings.HEALTH_CHECK_TIMEOUT_SECONDS,
                "auto_recovery_enabled": True,
                "gemini_model": settings.GEMINI_MODEL,
                "simulation_label": settings.SIMULATION_LABEL,
                "version": "1.0.0-hackathon-mvp",
            }
            conf_setting = Setting(
                key="platform_config",
                json_value=json.dumps(init_config),
                updated_at=get_utc_now(),
                updated_by="system_init",
            )
            session.add(conf_setting)

        await session.commit()
