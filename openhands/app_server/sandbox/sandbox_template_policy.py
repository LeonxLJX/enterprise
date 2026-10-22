"""Request-scoped template choices; existing sandbox metadata stays readable."""

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, model_validator

from openhands.app_server.errors import SandboxError
from openhands.app_server.sandbox.sandbox_spec_models import (
    SandboxSpecInfo,
    SandboxSpecInfoPage,
)
from openhands.app_server.sandbox.sandbox_spec_service import SandboxSpecService


class SandboxTemplatePolicy(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)

    template_ids: list[str] = Field(min_length=1)
    default_template_id: str = Field(min_length=1)
    selector_enabled: bool = False

    @model_validator(mode='after')
    def validate_templates(self) -> 'SandboxTemplatePolicy':
        if any(not value or value != value.strip() for value in self.template_ids):
            raise ValueError('Template IDs must be nonempty and trimmed')
        if len(set(self.template_ids)) != len(self.template_ids):
            raise ValueError('Template IDs must be unique')
        if self.default_template_id not in self.template_ids:
            raise ValueError('Default template must be in template_ids')
        return self


@dataclass
class ScopedSandboxSpecService(SandboxSpecService):
    delegate: SandboxSpecService
    policy: SandboxTemplatePolicy

    @property
    def selection_enabled(self) -> bool:
        return self.policy.selector_enabled

    @property
    def allow_sandbox_reuse(self) -> bool:
        # Existing sandbox records are user-owned, not org-owned. Do not share
        # one across org launch contexts, even when template names happen to match.
        return False

    async def get_sandbox_spec(self, sandbox_spec_id: str) -> SandboxSpecInfo | None:
        # Existing conversations/archive paths must still resolve their original
        # template after an administrator changes the list for NEW sandboxes.
        return await self.delegate.get_sandbox_spec(sandbox_spec_id)

    async def get_start_sandbox_spec(
        self, sandbox_spec_id: str
    ) -> SandboxSpecInfo | None:
        if sandbox_spec_id not in self.policy.template_ids:
            return None
        spec = await self.delegate.get_sandbox_spec(sandbox_spec_id)
        # Require stable IDs, never grant access through ambiguous image aliases.
        return spec if spec is not None and spec.id == sandbox_spec_id else None

    async def batch_get_sandbox_specs(
        self, sandbox_spec_ids: list[str]
    ) -> list[SandboxSpecInfo | None]:
        return [await self.get_start_sandbox_spec(id_) for id_ in sandbox_spec_ids]

    async def get_default_sandbox_spec(self) -> SandboxSpecInfo:
        spec = await self.get_start_sandbox_spec(self.policy.default_template_id)
        if spec is None:
            raise SandboxError('Organization default sandbox template is unavailable')
        return spec

    async def search_sandbox_specs(
        self, page_id: str | None = None, limit: int = 100
    ) -> SandboxSpecInfoPage:
        offset = int(page_id or 0)
        if offset < 0:
            raise ValueError('Invalid sandbox template page')
        # Paginate the org's IDs, not the global catalog, including when a
        # configured template has been removed from runtime-api.
        ids = self.policy.template_ids[offset : offset + limit]
        specs = [await self.get_start_sandbox_spec(id_) for id_ in ids]
        end = offset + len(ids)
        return SandboxSpecInfoPage(
            items=[spec for spec in specs if spec is not None],
            next_page_id=str(end) if end < len(self.policy.template_ids) else None,
        )
