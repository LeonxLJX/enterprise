"""Helm-managed organization template access and organization-wide rollout."""

import os
from functools import lru_cache
from uuid import UUID

from pydantic import TypeAdapter

from openhands.app_server.sandbox.sandbox_template_policy import SandboxTemplatePolicy
from server.services.feature_flag_service import feature_flag_service

SANDBOX_SELECTOR_FLAG = 'ENABLE_SANDBOX_SELECTOR'
ORG_TEMPLATES_ENV = 'SANDBOX_TEMPLATE_ORG_CONFIG'
feature_flag_service.register_env_default(
    SANDBOX_SELECTOR_FLAG, SANDBOX_SELECTOR_FLAG, False
)


@lru_cache(maxsize=1)
def _parse_org_templates(value: str) -> dict[UUID, SandboxTemplatePolicy]:
    return TypeAdapter(dict[UUID, SandboxTemplatePolicy]).validate_json(value)


async def get_org_template_policy(org_id: UUID | None) -> SandboxTemplatePolicy | None:
    if org_id is None:
        return None
    policies = _parse_org_templates(os.environ.get(ORG_TEMPLATES_ENV, '{}'))
    policy = policies.get(org_id)
    if policy is None:
        return None
    # Deliberately omit user/email context: all members see the same org flag.
    enabled = await feature_flag_service.is_enabled(
        SANDBOX_SELECTOR_FLAG, org_id=str(org_id)
    )
    return policy.model_copy(update={'selector_enabled': enabled})
