"""Pooled internal HTTP transport, scoped to the owning process lifecycle."""

from contextlib import asynccontextmanager
from contextvars import ContextVar
import httpx

transport_client = ContextVar("rebound_http_client", default=None)


@asynccontextmanager
async def internal_client(timeout=5.0):
    pooled = transport_client.get()
    if pooled is not None:
        yield pooled
    else:
        # One-shot utilities/tests also close their own connections.
        async with httpx.AsyncClient(timeout=timeout) as client:
            yield client
