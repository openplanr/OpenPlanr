Feature: Repository-wide revision with --all flag and safety limits
  US-046 - As a As a developer, I want to I want to run planr revise --all to revise all artifacts in my repository so that So that I can keep my entire planning hierarchy aligned with codebase changes in one operation

  Background:
    Given the system is initialized

  Scenario: Successful bulk revision within safety limits
    Given A repository with 50 artifacts and max_writes_per_run set to 100
    When I run planr revise --all
    Then All artifacts are processed in cascade order and revised successfully

  Scenario: Safety limit prevents excessive writes
    Given A repository with 200 artifacts and max_writes_per_run set to 50
    When I run planr revise --all
    Then Processing stops after 50 writes with a clear message about the safety limit

  Scenario: Typed confirmation required for bulk operations
    Given A repository ready for bulk revision
    When I run planr revise --all without --yes flag
    Then I am prompted to type 'YES' to confirm the destructive bulk operation

