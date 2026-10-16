from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, Request
from pydantic import SecretStr

from server.auth.login_policy import (
    enforce_enterprise_sso,
    require_native_login_allowed,
)
from server.auth.token_manager import KeycloakUserInfo
from server.routes.auth import keycloak_link_context


@pytest.mark.parametrize(
    'marker, expected',
    [
        ('enterprise_sso:saml', 'enterprise_sso'),
        ('github', 'github'),
        ('azure_devops', 'azure_devops'),
        ('unknown', None),
        (None, None),
    ],
)
@pytest.mark.asyncio
async def test_server_hint_uses_authenticated_user_info(monkeypatch, marker, expected):
    monkeypatch.delenv('ENFORCE_ENTERPRISE_SSO', raising=False)
    with (
        patch(
            'server.routes.auth.get_access_token',
            AsyncMock(return_value=SecretStr('test')),
        ),
        patch(
            'server.routes.auth.token_manager.get_user_info',
            AsyncMock(
                return_value=KeycloakUserInfo(sub='user', identity_provider=marker)
            ),
        ),
    ):
        result = await keycloak_link_context(MagicMock(spec=Request))
    assert result.provider == expected


@pytest.mark.asyncio
async def test_link_context_requires_authentication():
    with patch('server.routes.auth.get_access_token', AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc:
            await keycloak_link_context(MagicMock(spec=Request))
    assert exc.value.status_code == 401


@pytest.mark.parametrize('value', ['true', '1'])
@pytest.mark.asyncio
async def test_enforcement_overrides_a_stale_provider_marker(monkeypatch, value):
    monkeypatch.setenv('ENFORCE_ENTERPRISE_SSO', value)
    with (
        patch(
            'server.routes.auth.get_access_token',
            AsyncMock(return_value=SecretStr('test')),
        ),
        patch(
            'server.routes.auth.token_manager.get_user_info',
            AsyncMock(
                return_value=KeycloakUserInfo(sub='user', identity_provider='github')
            ),
        ),
    ):
        result = await keycloak_link_context(MagicMock(spec=Request))
    assert result.provider == 'enterprise_sso'
    assert enforce_enterprise_sso()
    with pytest.raises(HTTPException) as exc:
        require_native_login_allowed()
    assert exc.value.status_code == 403


@pytest.mark.parametrize('value', ['false', '0', ''])
def test_other_login_stack_remains_available_by_default(monkeypatch, value):
    monkeypatch.setenv('ENFORCE_ENTERPRISE_SSO', value)
    assert not enforce_enterprise_sso()
    require_native_login_allowed()


def test_native_cookie_cannot_be_minted_under_managed_sso_policy(monkeypatch):
    from server.auth.provider_identity import set_oauth_v2_cookie

    monkeypatch.setenv('ENFORCE_ENTERPRISE_SSO', 'true')
    response = MagicMock()
    with pytest.raises(HTTPException) as exc:
        set_oauth_v2_cookie(MagicMock(spec=Request), response, 'user', None, True, 1)
    assert exc.value.status_code == 403
    response.set_cookie.assert_not_called()


@pytest.mark.asyncio
async def test_native_login_denied_before_user_lookup_or_creation(monkeypatch):
    from server.auth.provider_identity import resolve_or_create_user

    monkeypatch.setenv('ENFORCE_ENTERPRISE_SSO', '1')
    with patch('server.auth.provider_identity.AuthProviderUserStore') as store:
        with pytest.raises(HTTPException) as exc:
            await resolve_or_create_user(MagicMock(), {'sub': 'native-user'})
    assert exc.value.status_code == 403
    store.assert_not_called()


@pytest.mark.asyncio
async def test_password_idp_denied_before_provider_lookup(monkeypatch):
    from server.routes.idp import _require_idp_available

    monkeypatch.setenv('ENFORCE_ENTERPRISE_SSO', 'true')
    with patch('server.routes.idp._get_integrated_idp_provider') as lookup:
        with pytest.raises(HTTPException) as exc:
            await _require_idp_available()
    assert exc.value.status_code == 403
    lookup.assert_not_called()


def test_password_idp_cannot_mint_a_cookie_under_policy(monkeypatch):
    from server.routes.idp import _set_idp_cookie

    monkeypatch.setenv('ENFORCE_ENTERPRISE_SSO', 'true')
    response = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _set_idp_cookie(MagicMock(spec=Request), response, 'user', True, True, 1)
    assert exc.value.status_code == 403
    response.set_cookie.assert_not_called()
