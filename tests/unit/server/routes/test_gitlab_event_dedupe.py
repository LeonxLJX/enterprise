"""POST /integration/gitlab/events drops repeat deliveries, against a real database.

Signature checks run against real webhook rows. Most tests replace the GitLab
manager the handler passes accepted events to, which would otherwise start
conversations. The tests near the end run the real manager instead, faking
only GitLab's REST API, the identity provider and the conversation start.
"""

import asyncio
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from keycloak.exceptions import KeycloakConnectionError
from pydantic import SecretStr
from sqlalchemy import func, select, text, update
from starlette.requests import Request

import integrations.gitlab.gitlab_manager as gitlab_manager_module
import openhands.app_server.integrations.gitlab.gitlab_service as gitlab_service_module
import server.routes.integration.gitlab as route_module
import storage.gitlab_delivery_store as delivery_store_module
import storage.gitlab_webhook_store as webhook_store_module
import storage.org_git_claim_store as org_git_claim_store_module
from integrations.gitlab.gitlab_manager import GitlabManager
from integrations.gitlab.gitlab_service import SaaSGitLabService
from integrations.gitlab.gitlab_view import GitlabIssueComment
from openhands.app_server.integrations.service_types import RequestMethod
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


async def count_deliveries(async_session_maker) -> int:
    async with async_session_maker() as session:
        return await session.scalar(select(func.count()).select_from(GitlabDelivery))


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


async def test_a_delivery_that_is_not_json_is_rejected_and_not_recorded(
    manager, hook_row, async_session_maker
):
    rejected = await deliver(b'{"object_kind": "note", ')

    assert rejected.status_code == 400
    assert await count_deliveries(async_session_maker) == 0
    assert manager.payloads == []


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

    assert await count_deliveries(async_session_maker) == 5 + 1


class FakeGitLabApi:
    """GitLab's REST API as the handler's GitLab service calls it.

    ``project_statuses`` queues the HTTP statuses of the next project lookups,
    which is where the commenter's access level is read. ``comments`` holds
    the comments it accepted.
    """

    def __init__(self):
        self.access_level = 30
        self.project_statuses: list[int] = []
        self.comment_status = 201
        self.comments: list[str] = []

    async def execute_request(self, client, url, headers, params, method):
        request = httpx.Request(method.value.upper(), url)
        if method == RequestMethod.POST:
            if self.comment_status == 201:
                self.comments.append(params['body'])
            return httpx.Response(self.comment_status, json={}, request=request)
        status = self.project_statuses.pop(0) if self.project_statuses else 200
        if status != 200:
            return httpx.Response(status, json={'message': 'error'}, request=request)
        access = {'access_level': self.access_level, 'notification_level': 3}
        return httpx.Response(
            200,
            json={'permissions': {'project_access': access, 'group_access': None}},
            request=request,
        )


class FakeIdentityProvider:
    """The token manager's lookups, which go to Keycloak in production."""

    def __init__(self):
        self.token_failures = 0

    async def get_user_id_from_idp_user_id(self, idp_user_id, idp):
        return 'keycloak-user-1'

    async def get_idp_token_from_idp_user_id(self, idp_user_id, idp):
        if self.token_failures:
            self.token_failures -= 1
            raise KeycloakConnectionError('Keycloak unavailable')
        return 'gitlab-token'


class Conversations:
    """Records the conversations the real manager starts."""

    def __init__(self):
        self.started: list[int] = []
        self.failures = 0

    async def create(self, view):
        self.started.append(view.issue_number)
        if self.failures:
            self.failures -= 1
            raise RuntimeError('sandbox failed to start')
        view.conversation_id = 'conversation-1'


class RealManagerWorld:
    def __init__(self):
        self.gitlab = FakeGitLabApi()
        self.identity = FakeIdentityProvider()
        self.conversations = Conversations()


@pytest.fixture
def world(async_session_maker, monkeypatch):
    monkeypatch.setattr(delivery_store_module, 'a_session_maker', async_session_maker)
    monkeypatch.setattr(webhook_store_module, 'a_session_maker', async_session_maker)
    monkeypatch.setattr(org_git_claim_store_module, 'a_session_maker', async_session_maker)
    world = RealManagerWorld()
    monkeypatch.setattr(
        gitlab_service_module, '_gitlab_service_impl', SaaSGitLabService
    )
    monkeypatch.setattr(
        SaaSGitLabService,
        'execute_request',
        lambda service, *args, **kwargs: world.gitlab.execute_request(*args, **kwargs),
    )

    async def latest_token(service):
        return SecretStr('gitlab-token')

    monkeypatch.setattr(SaaSGitLabService, 'get_latest_token', latest_token)

    async def user_auth(keycloak_user_id, token_manager):
        return object()

    async def create_new_conversation(view, *args, **kwargs):
        await world.conversations.create(view)

    monkeypatch.setattr(gitlab_manager_module, 'get_saas_user_auth', user_auth)
    monkeypatch.setattr(
        GitlabIssueComment, 'create_new_conversation', create_new_conversation
    )
    monkeypatch.setattr(
        route_module, 'gitlab_manager', GitlabManager(world.identity)
    )
    return world


def issue_comment(text: str = '@openhands please fix') -> bytes:
    return json.dumps(
        {
            'object_kind': 'note',
            'event_type': 'note',
            'user': {'id': 7, 'username': 'alice'},
            'project': {
                'id': 42,
                'path_with_namespace': 'group/project',
                'visibility_level': 0,
            },
            'object_attributes': {
                'id': 1001,
                'note': text,
                'noteable_type': 'Issue',
                'discussion_id': 'discussion-1',
                'project_id': 42,
            },
            'issue': {'iid': 5},
        }
    ).encode()


async def test_a_delivery_whose_access_check_could_not_reach_gitlab_is_processed_when_sent_again(
    world, hook_row
):
    world.gitlab.project_statuses = [503]

    failed = await deliver(issue_comment())
    retried = await deliver(issue_comment())

    assert failed.status_code == 400
    assert retried.status_code == 200
    assert world.conversations.started == [5]


@pytest.mark.parametrize(
    'project_lookup',
    [{'access_level': 20}, {'status': 404}],
    ids=['below-developer', 'project-not-visible'],
)
async def test_a_commenter_without_write_access_is_ignored_and_not_reconsidered(
    world, hook_row, project_lookup
):
    world.gitlab.access_level = project_lookup.get('access_level', 30)
    world.gitlab.project_statuses = [project_lookup.get('status', 200)]

    ignored = await deliver(issue_comment())
    copy = await deliver(issue_comment())

    assert ignored.status_code == 200
    assert json.loads(copy.body)['message'] == 'Duplicate GitLab event ignored.'
    assert world.conversations.started == []
    assert world.gitlab.comments == []


async def test_a_job_that_failed_before_starting_a_conversation_is_started_when_sent_again(
    world, hook_row
):
    world.identity.token_failures = 1

    failed = await deliver(issue_comment())
    retried = await deliver(issue_comment())

    assert failed.status_code == 400
    assert retried.status_code == 200
    assert world.conversations.started == [5]
    assert "I'm on it!" in world.gitlab.comments[-1]


async def test_a_job_whose_conversation_start_failed_is_not_started_again(
    world, hook_row
):
    world.conversations.failures = 1

    failed = await deliver(issue_comment())
    copy = await deliver(issue_comment())

    assert failed.status_code == 200
    assert json.loads(copy.body)['message'] == 'Duplicate GitLab event ignored.'
    assert world.conversations.started == [5]
    assert world.gitlab.comments == [
        'Uh oh! There was an unexpected error starting the job :('
    ]


async def test_a_job_whose_acknowledgement_could_not_be_posted_is_not_started_again(
    world, hook_row
):
    world.gitlab.comment_status = 503

    first = await deliver(issue_comment())
    copy = await deliver(issue_comment())

    assert first.status_code == 200
    assert json.loads(copy.body)['message'] == 'Duplicate GitLab event ignored.'
    assert world.conversations.started == [5]
