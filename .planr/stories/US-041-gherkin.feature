Feature: Top-down cascade ordering for artifact revision
  US-041 - As a As a developer, I want to I want artifacts to be revised in top-down order (epic → features → stories → tasks) so that So that child artifacts see the revised parent content during processing

  Background:
    Given the system is initialized

  Scenario: Epic with features and stories cascade
    Given An epic with 2 features, each having 2 stories
    When I run planr revise --cascade on the epic
    Then The epic is revised first, then features see the revised epic content, then stories see revised feature content

  Scenario: Circular dependency detection
    Given Artifacts with circular references in their dependency chain
    When The cascade processor encounters the circular dependency
    Then It logs a warning and processes in hierarchy order, breaking the cycle gracefully

  Scenario: Mixed hierarchy levels
    Given A cascade starting from a feature that has both stories and tasks
    When The cascade processes the hierarchy
    Then It maintains strict top-down ordering: feature → stories → tasks

