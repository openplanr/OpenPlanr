Feature: Support dry-run mode for push operations
  US-061 - As a As a product manager, I want to I want to preview the complete Linear structure before creating it so that So that I can verify the hierarchy and make adjustments before making actual API calls

  Background:
    Given the system is initialized

  Scenario: Show complete hierarchy plan in dry-run mode
    Given I have an Epic with Features, Stories, and TaskLists
    When I run planr linear push EPIC-004 --dry-run
    Then I see a complete preview of the Linear project structure without any API calls

  Scenario: Display exact item count in dry-run
    Given I run dry-run on a medium project
    When The dry-run completes
    Then I see exactly 31 items would be created (1 project + 5 features + 20 stories + 5 tasklists)

  Scenario: Show idempotent operations in dry-run
    Given Some artifacts already have Linear IDs
    When I run dry-run mode
    Then I see which items would be created vs updated vs skipped

