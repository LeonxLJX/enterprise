from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from storage.database import a_session_maker
from storage.gitlab_delivery import GitlabDelivery

# Longer than GitLab keeps retrying or queueing a hook's deliveries.
RETENTION = timedelta(days=7)
PRUNE_BATCH = 100


@dataclass
class GitlabDeliveryStore:
    @asynccontextmanager
    async def claim(self, body: bytes) -> AsyncIterator[bool]:
        """Claim a delivery by its raw body while the caller processes it.

        Yields False if that body was already processed. The entry is written
        in a transaction that commits only when the block exits normally. If
        the block raises or is cancelled, or the process dies, the transaction
        rolls back and the body can be processed again. A copy claimed while
        another is in progress waits for that one to commit or roll back.

        First deletes a batch of entries older than RETENTION, in a transaction
        of its own so the deleted rows are not locked while the caller
        processes and stay deleted if it fails. The table stays bounded
        without a scheduled job.
        """
        digest = hashlib.sha256(body).hexdigest()
        expired = (
            select(GitlabDelivery.body_sha256)
            .where(GitlabDelivery.received_at < func.now() - RETENTION)
            .limit(PRUNE_BATCH)
            .with_for_update(skip_locked=True)
        )
        async with a_session_maker() as session:
            async with session.begin():
                await session.execute(
                    delete(GitlabDelivery).where(
                        GitlabDelivery.body_sha256.in_(expired)
                    )
                )
            async with session.begin():
                inserted = await session.execute(
                    insert(GitlabDelivery)
                    .values(body_sha256=digest)
                    .on_conflict_do_nothing(index_elements=['body_sha256'])
                    .returning(GitlabDelivery.body_sha256)
                )
                yield inserted.scalar_one_or_none() is not None
