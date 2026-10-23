"""POST /integration/gitlab/events drops repeat deliveries, against a real database.

Signature checks run against real webhook rows. The one fake is the GitLab
manager the handler passes accepted events to, which would otherwise start
conversations.
"""

import asyncio
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select, text, update
from starlette.requests import Request

import server.routes.integration.gitlab as route_module
import storage.gitlab_delivery_store as delivery_store_module
import storage.gitlab_webhook_store as webhook_store_module
from server.routes.integration.gitlab import gitlab_events
from storage.gitlab_delivery import GitlabDelivery
from storage.gitlab_delivery_store import (
    PRUNE_BATCH,
    RETENTION,
    GitlabDeliveryStore,
)
from storage.gitlab_webhook import GitlabWebhook

USER = 'user-1'
UUID = 'uuid-1'
SECRET = 'secret-1'


class RecordingManager:
    """Records each payload it is handed.

    A test can hold calls at ``gate`` and make the next ``failures`` calls raise.
    """

    def __init__(self):
        self.payloads: list[dict] = []
        self.failures = 0
        self.entered = asyncio.Event()
        self.gate = asyncio.Event()
        self.gate.set()

    async def receive_message(self, message):
        self.entered.set()
        await self.gate.wait()
        await asyncio.sleep(0)
        if self.failures:
            self.failures -= 1
            raise RuntimeError('GitLab API unavailable')
        self.payloads.append(message.message['payload'])


@pytest.fixture
def manager(async_session_maker, monkeypatch):
    monkeypatch.setattr(delivery_store_module, 'a_session_maker', async_session_maker)
    monkeypatch.setattr(webhook_store_module, 'a_session_maker', async_session_maker)
    recording = RecordingManager()
    monkeypatch.setattr(route_module, 'gitlab_manager', recording)
    return recording


@pytest.fixture
async def hook_row(async_session_maker):
    async with async_session_maker() as session, session.begin():
        session.add(
            GitlabWebhook(
                user_id=USER,
                project_id='project-1',
                webhook_exists=True,
                webhook_uuid=UUID,
                webhook_secret=SECRET,
            )
        )


@pytest.fixture
def age_deliveries(async_session_maker):
    async def age(by: timedelta):
        async with async_session_maker() as session, session.begin():
            await session.execute(
                update(GitlabDelivery).values(received_at=func.now() - by)
            )

    return age


def note_event(note_id: int = 1, text: str = '@openhands help') -> bytes:
    return json.dumps(
        {
            'object_kind': 'note',
            'object_attributes': {'id': note_id, 'note': text},
        }
    ).encode()


async def wait_for_a_delivery_blocked_on_another(async_session_maker):
    """Wait until a connection to this test's database waits on another's lock."""
    query = text(
        'SELECT count(*) FROM pg_stat_activity'
        " WHERE datname = current_database() AND wait_event_type = 'Lock'"
    )
    for _ in range(200):
        async with async_session_maker() as session:
            if await session.scalar(query):
                return
        await asyncio.sleep(0.025)
    pytest.fail('no delivery waited for the one in progress')


def deliver(body: bytes, token: str = SECRET):
    async def receive():
        return {'type': 'http.request', 'body': body, 'more_body': False}

    request = Request(
        {'type': 'http', 'method': 'POST', 'path': '/', 'headers': []}, receive
    )
    return gitlab_events(
        request=request,
        x_gitlab_token=token,
        x_openhands_webhook_id=UUID,
        x_openhands_user_id=USER,
    )


async def test_one_event_through_two_hooks_at_once_is_processed_once(manager, hook_row):
    responses = await asyncio.gather(deliver(note_event()), deliver(note_event()))

    assert [r.status_code for r in responses] == [200, 200]
    assert len(manager.payloads) == 1


async def test_a_copy_arriving_long_after_the_first_is_still_dropped(
    manager, hook_row, age_deliveries
):
    await deliver(note_event())
    await age_deliveries(timedelta(hours=1))

    response = await deliver(note_event())

    assert json.loads(response.body)['message'] == 'Duplicate GitLab event ignored.'
    assert len(manager.payloads) == 1


async def test_distinct_events_on_the_same_object_are_both_processed(manager, hook_row):
    await deliver(note_event(note_id=7, text='first'))
    await deliver(note_event(note_id=7, text='second'))

    assert [p['object_attributes']['note'] for p in manager.payloads] == [
        'first',
        'second',
    ]


async def test_a_delivery_that_fails_authentication_is_not_recorded(manager, hook_row):
    rejected = await deliver(note_event(), token='wrong-secret')
    await deliver(note_event())

    assert rejected.status_code != 200
    assert len(manager.payloads) == 1


async def test_a_delivery_whose_processing_failed_is_processed_when_sent_again(
    manager, hook_row
):
    manager.failures = 1

    failed = await deliver(note_event())
    retried = await deliver(note_event())

    assert failed.status_code == 400
    assert retried.status_code == 200
    assert len(manager.payloads) == 1


async def test_a_copy_arriving_while_the_first_fails_waits_and_is_then_processed(
    manager, hook_row, async_session_maker
):
    manager.gate.clear()
    manager.failures = 1
    first = asyncio.create_task(deliver(note_event()))
    await manager.entered.wait()

    copy = asyncio.create_task(deliver(note_event()))
    await wait_for_a_delivery_blocked_on_another(async_session_maker)
    assert not copy.done()
    manager.gate.set()

    assert (await first).status_code == 400
    copy_message = json.loads((await copy).body)['message']
    assert copy_message == 'GitLab events endpoint reached successfully.'
    assert len(manager.payloads) == 1


async def test_a_copy_arriving_while_the_first_succeeds_waits_and_is_dropped(
    manager, hook_row, async_session_maker
):
    manager.gate.clear()
    first = asyncio.create_task(deliver(note_event()))
    await manager.entered.wait()

    copy = asyncio.create_task(deliver(note_event()))
    await wait_for_a_delivery_blocked_on_another(async_session_maker)
    assert not copy.done()
    manager.gate.set()

    assert (await first).status_code == 200
    copy_message = json.loads((await copy).body)['message']
    assert copy_message == 'Duplicate GitLab event ignored.'
    assert len(manager.payloads) == 1


async def test_a_delivery_cancelled_mid_processing_is_processed_when_sent_again(
    manager, hook_row
):
    manager.gate.clear()
    cancelled = asyncio.create_task(deliver(note_event()))
    await manager.entered.wait()
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    manager.gate.set()

    retried = await deliver(note_event())

    assert retried.status_code == 200
    assert len(manager.payloads) == 1


# The real handler, in a process of its own whose manager never returns.
HANDLER_THAT_HANGS = """
import asyncio, os
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import server.routes.integration.gitlab as route_module
import storage.gitlab_delivery_store as delivery_store_module
import storage.gitlab_webhook_store as webhook_store_module
from tests.unit.server.routes.test_gitlab_event_dedupe import deliver, note_event

engine = create_async_engine(os.environ['DEDUPE_TEST_DB_URL'], poolclass=NullPool)
delivery_store_module.a_session_maker = async_sessionmaker(engine)
webhook_store_module.a_session_maker = async_sessionmaker(engine)

class HangingManager:
    async def receive_message(self, message):
        print('processing', flush=True)
        await asyncio.Event().wait()

route_module.gitlab_manager = HangingManager()
asyncio.run(deliver(note_event()))
"""


async def test_a_delivery_whose_process_died_mid_processing_is_processed_when_sent_again(
    manager, hook_row, test_database
):
    db_url = test_database.async_url.render_as_string(hide_password=False)
    handler = await asyncio.create_subprocess_exec(
        sys.executable,
        '-c',
        HANDLER_THAT_HANGS,
        env=os.environ | {'DEDUPE_TEST_DB_URL': db_url},
        cwd=Path(__file__).parents[4],
        stdout=asyncio.subprocess.PIPE,
    )
    try:
        assert handler.stdout is not None
        async with asyncio.timeout(120):
            while (line := await handler.stdout.readline()) != b'processing\n':
                assert line, 'the handler exited before processing'
    finally:
        handler.kill()
        await handler.wait()

    retried = await deliver(note_event())

    assert retried.status_code == 200
    assert len(manager.payloads) == 1


async def claim_and_finish(body: bytes) -> bool:
    async with GitlabDeliveryStore().claim(body) as is_new:
        return is_new


async def test_a_claim_is_new_only_for_the_first_of_concurrent_copies(manager):
    results = await asyncio.gather(*(claim_and_finish(b'same body') for _ in range(5)))

    assert sorted(results) == [False, False, False, False, True]


async def test_an_entry_past_retention_is_pruned_and_its_body_counts_as_new(
    manager, age_deliveries
):
    await claim_and_finish(b'old')
    await age_deliveries(RETENTION + timedelta(minutes=1))

    assert await claim_and_finish(b'old')
    assert not await claim_and_finish(b'old')


async def test_entries_past_retention_stay_pruned_when_the_pruning_delivery_fails(
    manager, hook_row, age_deliveries, async_session_maker
):
    await claim_and_finish(b'old')
    await age_deliveries(RETENTION + timedelta(minutes=1))
    manager.failures = 1

    failed = await deliver(note_event())

    assert failed.status_code == 400
    async with async_session_maker() as session:
        left = await session.scalar(select(func.count()).select_from(GitlabDelivery))
    assert left == 0


async def test_pruning_deletes_at_most_one_batch_per_claim(
    manager, age_deliveries, async_session_maker
):
    for n in range(PRUNE_BATCH + 5):
        await claim_and_finish(f'old-{n}'.encode())
    await age_deliveries(RETENTION + timedelta(minutes=1))

    await claim_and_finish(b'new')

    async with async_session_maker() as session:
        left = await session.scalar(select(func.count()).select_from(GitlabDelivery))
    assert left == 5 + 1
