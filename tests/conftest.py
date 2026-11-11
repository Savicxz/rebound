"""Keep tests away from the running demo and the developer's credentials."""

import asyncio
from contextlib import ExitStack
import os
from pathlib import Path
import socket
import tempfile

import pytest


test_directory = tempfile.TemporaryDirectory(
    prefix="rebound-tests-", ignore_cleanup_errors=True
)
with ExitStack() as stack:
    sockets = [stack.enter_context(socket.socket()) for _ in range(2)]
    for connection in sockets:
        connection.bind(("127.0.0.1", 0))
    control_port, service_port = [connection.getsockname()[1] for connection in sockets]

os.environ.update(
    {
        "ENVIRONMENT": "demo",
        "DATABASE_URL": f"sqlite+aiosqlite:///{(Path(test_directory.name) / 'tests.sqlite').as_posix()}",
        "RUNNER_CONTROL_PORT": str(control_port),
        "RUNNER_DEMO_PORT": str(service_port),
        "RUNNER_CONTROL_URL": f"http://127.0.0.1:{control_port}",
        "RUNNER_DEMO_SERVICE_URL": f"http://127.0.0.1:{service_port}",
        "RUNNER_AUTH_TOKEN": "rebound-test-runner-token-not-for-production",
        "GEMINI_API_KEY": "",
        "GEMINI_ENTERPRISE_ENABLED": "false",
    }
)


@pytest.fixture(scope="session", autouse=True)
def close_test_database():
    yield
    from services.api.database import engine

    asyncio.run(engine.dispose())
    test_directory.cleanup()
