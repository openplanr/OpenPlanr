Feature: Linear sync command with dry-run mode
  US-070 - As a As a product manager, I want to I want to run a sync command with dry-run mode so that So that I can see what changes would be made before executing them

  Background:
    Given the system is initialized

  Scenario: Dry-run shows planned changes
    Given I have an epic with features and stories
    When I run 'planr linear sync EPIC-004 --dry-run'
    Then I see a detailed plan of what would be created/updated without any API calls being made

  Scenario: Dry-run with no changes
    Given Linear is already in sync with OpenPlanr
    When I run 'planr linear sync EPIC-004 --dry-run'
    Then I see a message indicating no changes are needed

  Scenario: Dry-run shows bidirectional changes
    Given There are checkbox and status changes in both systems
    When I run 'planr linear sync EPIC-004 --dry-run'
    Then I see planned changes for both push and pull operations

