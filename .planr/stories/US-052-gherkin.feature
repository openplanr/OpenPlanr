Feature: Comprehensive audit log output
  US-052 - As a As a developer, I want to I want detailed audit logs in both Markdown and JSON formats so that So that I can review revision decisions and integrate with other tools

  Background:
    Given the system is initialized

  Scenario: Audit log captures comprehensive revision data
    Given I run a revision operation on multiple artifacts
    When The revision completes
    Then An audit log should be created with token usage, cache stats, and decisions for each artifact

  Scenario: Audit log supports both formats
    Given I need audit logs for different consumers
    When I specify --audit-format json or markdown
    Then The audit log should be generated in the requested format

