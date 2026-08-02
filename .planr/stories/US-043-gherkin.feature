Feature: Audit log grouping by cascade level and artifact type
  US-043 - As a As a developer, I want to I want audit logs grouped by cascade level and artifact type so that So that I can easily understand what was changed at each level of the hierarchy

  Background:
    Given the system is initialized

  Scenario: Multi-level cascade audit grouping
    Given A cascade that processes 1 epic, 3 features, and 8 stories
    When The cascade completes
    Then The audit log shows three distinct groups: Epic (1 item), Features (3 items), Stories (8 items)

  Scenario: Mixed artifact types at same level
    Given A feature containing both stories and tasks at the child level
    When The cascade processes the feature's children
    Then The audit log groups stories and tasks separately even though they're at the same hierarchy level

  Scenario: Empty cascade level
    Given An epic with features but some features have no stories
    When The cascade processes all levels
    Then The audit log includes empty groups for levels with no artifacts to process

