from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from storage.database import a_session_maker
from storage.gitlab_delivery import GitlabDelivery

# Longer than GitLab keeps a hook's deliveries queued, so a late copy is still
# recognized.
RETENTION = timedelta(days=7)
# Longer than processing one event takes, including the sandbox start-up a new
# conversation waits for. A claim this old that never finished is taken to
# belong to a process that died.
LEASE = timedelta(minutes=15)
PRUNE_BATCH = 100


@dataclass
class GitlabDeliveryStore:
    @asynccontextmanager
    async def claim(self, body: bytes) -> AsyncIterator[bool]:
        """Claim a delivery by its raw body while the caller processes it.

        Yields False if that body was already processed, or is being processed
        under a claim younger than LEASE. The claim is committed at once, so no
        database connection is held while the caller processes. It is marked
        processed when the block exits normally and deleted if the block raises
        or is cancelled, so a later copy is processed.
        """
        digest = hashlib.sha256(body).hexdigest()
        claimed_at = await self._take(digest)
        if claimed_at is None:
            yield False
            return
        try:
            yield True
        except BaseException:
            await self._release(digest, claimed_at)
            raise
        await self._finish(digest, claimed_at)

    async def _take(self, digest: str) -> datetime | None:
        """Claim ``digest``; return the claim's time, or None if it is taken.

        First deletes a batch of entries older than RETENTION, so the table
        stays bounded without a scheduled job.
        """
        expired = (
            select(GitlabDelivery.body_sha256)
            .where(GitlabDelivery.received_at < func.now() - RETENTION)
            .limit(PRUNE_BATCH)
            .with_for_update(skip_locked=True)
        )
        claim = (
            insert(GitlabDelivery)
            .values(body_sha256=digest)
            .on_conflict_do_update(
                index_elements=['body_sha256'],
                set_={'received_at': func.now()},
                where=GitlabDelivery.processed_at.is_(None)
                & (GitlabDelivery.received_at < func.now() - LEASE),
            )
            .returning(GitlabDelivery.received_at)
        )
        async with a_session_maker() as session, session.begin():
            await session.execute(
                delete(GitlabDelivery).where(GitlabDelivery.body_sha256.in_(expired))
            )
            return (await session.execute(claim)).scalar_one_or_none()

    async def _finish(self, digest: str, claimed_at: datetime) -> None:
        async with a_session_maker() as session, session.begin():
            await session.execute(
                update(GitlabDelivery)
                .where(
                    GitlabDelivery.body_sha256 == digest,
                    GitlabDelivery.received_at == claimed_at,
                )
                .values(processed_at=func.now())
            )

    async def _release(self, digest: str, claimed_at: datetime) -> None:
        # Matching on the claim's time leaves in place a newer claim on the same
        # body, taken after this one's lease ran out.
        async with a_session_maker() as session, session.begin():
            await session.execute(
                delete(GitlabDelivery).where(
                    GitlabDelivery.body_sha256 == digest,
                    GitlabDelivery.received_at == claimed_at,
                )
            )
