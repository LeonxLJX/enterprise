from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ConfigurationOperation(StrEnum):
    LOCKED = 'locked'
    REPLACE = 'replace'
    SUBSET = 'subset'
    EXTEND = 'extend'


class ConfigurationRule(BaseModel):
    operation: ConfigurationOperation = ConfigurationOperation.EXTEND


class ConfigurationPolicy(BaseModel):
    llm: ConfigurationRule = Field(default_factory=ConfigurationRule)
    settings: dict[str, ConfigurationRule] = Field(default_factory=dict)

    def operation_for_settings_section(
        self, section_key: str
    ) -> ConfigurationOperation:
        rule = self.settings.get(section_key)
        return rule.operation if rule is not None else ConfigurationOperation.EXTEND


def load_configuration_policy(value: dict[str, Any] | None) -> ConfigurationPolicy:
    try:
        return ConfigurationPolicy.model_validate(value or {})
    except (TypeError, ValueError):
        return ConfigurationPolicy()
