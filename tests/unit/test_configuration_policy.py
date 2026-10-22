from storage.configuration_policy import (
    ConfigurationOperation,
    load_configuration_policy,
)


def test_configuration_policy_supports_rules_for_every_settings_section() -> None:
    policy = load_configuration_policy(
        {
            'llm': {'operation': 'subset'},
            'settings': {
                'product.prototype': {'operation': 'locked'},
                'agent.condenser': {'operation': 'replace'},
            },
        }
    )

    assert policy.llm.operation is ConfigurationOperation.SUBSET
    assert (
        policy.operation_for_settings_section('product.prototype')
        is ConfigurationOperation.LOCKED
    )
    assert (
        policy.operation_for_settings_section('agent.condenser')
        is ConfigurationOperation.REPLACE
    )
    assert (
        policy.operation_for_settings_section('conversation.general')
        is ConfigurationOperation.EXTEND
    )


def test_invalid_configuration_policy_falls_back_to_defaults() -> None:
    policy = load_configuration_policy(
        {'settings': {'product.prototype': {'operation': 'invalid'}}}
    )

    assert policy.llm.operation is ConfigurationOperation.EXTEND
    assert (
        policy.operation_for_settings_section('product.prototype')
        is ConfigurationOperation.EXTEND
    )
