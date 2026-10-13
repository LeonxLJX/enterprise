"""GitLab resolver on installs without Keycloak (integrated IDP, OAuth v2).

The user linked GitLab through ``/oauth/{provider_id}/link``, so the GitLab
user id lives in ``oauth_provider_users`` and the token in ``oauth_tokens``.
Keycloak is unconfigured; any call to it fails the test.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from pydantic import SecretStr

from integrations.gitlab.gitlab_service import SaaSGitLabService
from integrations.gitlab.gitlab_view import OH_LABEL, GitlabFactory, GitlabIssue
from integrations.models import Message, SourceType
from integrations.v1_utils import get_saas_user_auth
from openhands.app_server.integrations.service_types import ProviderType
from openhands.app_server.services.jwt_service import JwtService
from openhands.app_server.utils.encryption_key import EncryptionKey
from server.auth.gitlab_sync import _user_has_gitlab_provider
from server.auth.saas_user_auth import SaasUserAuth
from server.auth.token_manager import TokenManager
from storage.auth_provider import AuthProvider
from storage.auth_provider_details import OAuthProviderDetails
from storage.oauth_provider_user_store import OAuthProviderUserStore
from storage.oauth_token_store import OAuthTokenStore

GITLAB_USER_ID = 4242
GITLAB_TOKEN = 'glpat-linked-through-oauth-v2'


def _fail_keycloak(*args, **kwargs):
    raise AssertionError('Keycloak must not be called')


@pytest.fixture
def no_keycloak(async_session_maker):
    jwt_svc = JwtService(
        keys=[EncryptionKey(kid='test', key=SecretStr('test_secret'), active=True)]
    )
    patches = [
        patch('storage.auth_provider_store.a_session_maker', async_session_maker),
        patch('storage.oauth_provider_user_store.a_session_maker', async_session_maker),
        patch('storage.oauth_token_store.a_session_maker', async_session_maker),
        patch('storage.offline_token_store.a_session_maker', async_session_maker),
        patch('storage.database.a_session_maker', async_session_maker),
        patch('storage.encrypt_utils.get_jwt_service', return_value=jwt_svc),
        patch('server.auth.token_manager.KEYCLOAK_SERVER_URL', ''),
        patch('server.auth.token_manager.get_keycloak_admin', _fail_keycloak),
        patch('server.auth.token_manager.get_keycloak_openid', _fail_keycloak),
    ]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


@pytest.fixture
async def gitlab_provider(no_keycloak, async_session_maker) -> AuthProvider:
    provider = AuthProvider(
        title='GitLab',
        is_idp=False,
        details=OAuthProviderDetails(
            provider_type=ProviderType.GITLAB,
            client_id='gitlab-client',
            client_secret=SecretStr('gitlab-secret'),
            authorization_url='https://gitlab.example.com/oauth/authorize',
            token_url='https://gitlab.example.com/oauth/token',
            userinfo_url='https://gitlab.example.com/api/v4/user',
            scopes=['api'],
        ),
    )
    async with async_session_maker() as session:
        session.add(provider)
        await session.commit()
        await session.refresh(provider)
    return provider


@pytest.fixture
async def linked_user_id(gitlab_provider, create_user) -> str:
    user_id = create_user().id
    await OAuthProviderUserStore().link(
        oauth_provider_id=gitlab_provider.id,
        user_id=user_id,
        external_subject_id=str(GITLAB_USER_ID),
    )
    await OAuthTokenStore(
        user_id=user_id, oauth_provider_id=gitlab_provider.id
    ).store_tokens(
        access_token=GITLAB_TOKEN,
        refresh_token='refresh',
        access_token_expires_at=None,
        refresh_token_expires_at=None,
    )
    return str(user_id)


def _labeled_issue_message() -> Message:
    return Message(
        source=SourceType.GITLAB,
        message={
            'installation_id': 'hook-1',
            'payload': {
                'object_kind': 'issue',
                'event_type': 'issue',
                'user': {'id': GITLAB_USER_ID, 'username': 'alice'},
                'project': {
                    'id': 7,
                    'path_with_namespace': 'group/repo',
                    'visibility_level': 0,
                },
                'object_attributes': {'project_id': 7, 'iid': 3},
                'changes': {
                    'labels': {'previous': [], 'current': [{'title': OH_LABEL}]}
                },
            },
        },
    )


@pytest.mark.asyncio
async def test_resolves_gitlab_user_from_oauth_v2_link(linked_user_id):
    user_id = await TokenManager().get_user_id_from_idp_user_id(
        GITLAB_USER_ID, ProviderType.GITLAB
    )
    assert user_id == linked_user_id


@pytest.mark.asyncio
async def test_unlinked_gitlab_user_is_none_without_keycloak(linked_user_id):
    user_id = await TokenManager().get_user_id_from_idp_user_id(
        999, ProviderType.GITLAB
    )
    assert user_id is None


@pytest.mark.asyncio
async def test_gitlab_token_from_idp_user_id(linked_user_id):
    token = await TokenManager().get_idp_token_from_idp_user_id(
        str(GITLAB_USER_ID), ProviderType.GITLAB
    )
    assert token == GITLAB_TOKEN


@pytest.mark.asyncio
async def test_gitlab_token_missing_for_user_without_link(gitlab_provider, create_user):
    token = await TokenManager().get_git_provider_token_for_user(
        str(create_user().id), ProviderType.GITLAB
    )
    assert token is None


@pytest.mark.asyncio
async def test_saas_gitlab_service_uses_oauth_v2_token(linked_user_id):
    service = SaaSGitLabService(external_auth_id=linked_user_id)
    token = await service.get_latest_token()
    assert token is not None
    assert token.get_secret_value() == GITLAB_TOKEN


@pytest.mark.asyncio
async def test_gitlab_view_carries_internal_user_id(linked_user_id):
    view = await GitlabFactory.create_gitlab_view_from_payload(
        _labeled_issue_message(), TokenManager()
    )
    assert isinstance(view, GitlabIssue)
    assert view.user_info.keycloak_user_id == linked_user_id


@pytest.mark.asyncio
async def test_resolver_user_auth_reads_oauth_v2_git_tokens(linked_user_id):
    user_auth = await get_saas_user_auth(linked_user_id, TokenManager())
    assert isinstance(user_auth, SaasUserAuth)
    assert user_auth.oauth_v2_cookie is True

    # get_secrets only supplies optional per-provider host overrides.
    with patch.object(user_auth, 'get_secrets', new=AsyncMock(return_value=None)):
        provider_tokens = await user_auth.get_provider_tokens()

    assert provider_tokens is not None
    assert provider_tokens[ProviderType.GITLAB].token.get_secret_value() == (
        GITLAB_TOKEN
    )


@pytest.mark.asyncio
async def test_background_repo_sync_runs_for_oauth_v2_gitlab_user(linked_user_id):
    assert await _user_has_gitlab_provider(linked_user_id) is True


@pytest.mark.asyncio
async def test_background_repo_sync_skips_user_without_gitlab(
    gitlab_provider, create_user
):
    assert await _user_has_gitlab_provider(str(create_user().id)) is False


@pytest.mark.asyncio
async def test_resolver_user_auth_keeps_legacy_path_without_oauth_v2_links(
    no_keycloak, create_user
):
    user_id = str(create_user().id)
    user_auth = await get_saas_user_auth(user_id, TokenManager())
    assert isinstance(user_auth, SaasUserAuth)
    assert user_auth.oauth_v2_cookie is False
    assert user_auth.user_id == user_id
