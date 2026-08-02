Feature: Post-flight graph integrity verification with automatic rollback
  US-047 - As a As a developer, I want to I want automatic detection and rollback when bulk operations corrupt the artifact graph so that So that I never end up with a broken planning hierarchy after revision operations

  Background:
    Given the system is initialized

  Scenario: Successful revision passes integrity check
    Given A bulk revision operation completes successfully
    When Post-flight integrity verification runs
    Then Graph integrity passes and changes are committed

  Scenario: Integrity failure triggers automatic rollback
    Given A bulk revision operation corrupts parent-child links
    When Post-flight integrity verification detects corruption
    Then All changes are automatically rolled back via git and the corruption is reported

  Scenario: Rollback restores exact previous state
    Given An integrity failure has triggered rollback
    When The git rollback completes
    Then The repository is restored to the exact state before the revision operation began

