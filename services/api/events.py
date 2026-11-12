"""Committed-state invalidations, not speculative in-memory worker messages.

Clients reconcile authoritative snapshots; intermediate revisions may coalesce.
The single relay per API process reads the database, so SQLite and PostgreSQL
workers need no shared Python memory or extra broker.
"""

import asyncio
import logging
from services.api.database import AsyncSessionLocal
from services.api.models import RealtimeRevision


async def current_revision():
    async with AsyncSessionLocal() as session:
        row = await session.get(RealtimeRevision, 1)
        return {
            "type": "COMMITTED",
            "revision": row.revision,
            "timestamp": row.changed_at.isoformat(),
        }


class EventBroadcaster:
    def __init__(self):
        self.subscribers = set()

    async def subscribe(self):
        queue = asyncio.Queue(maxsize=1)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue):
        self.subscribers.discard(queue)

    async def relay(self):
        previous = -1
        while True:
            try:
                if self.subscribers:
                    message = await current_revision()
                    if message["revision"] != previous:
                        previous = message["revision"]
                        for queue in tuple(self.subscribers):
                            if queue.full():
                                queue.get_nowait()
                            queue.put_nowait(message)
            except Exception:
                logging.getLogger(__name__).exception(
                    "Change-feed read failed; retrying"
                )
            await asyncio.sleep(0.25)


broadcaster = EventBroadcaster()
