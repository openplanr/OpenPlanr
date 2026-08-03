Feature: Update-only sync mode
  US-071 - As a As a developer, I want to I want to sync only existing items without creating new ones so that So that I can update statuses and checkboxes without accidentally creating duplicate items

  Background:
    Given the system is initialized

  Scenario: Update-only skips new items
    Given I have new stories in OpenPlanr that don't exist in Linear
    When I run 'planr linear sync EPIC-004 --update-only'
    Then Only existing Linear items are updated and no new items are created

  Scenario: Update-only syncs checkboxes
    Given Existing Linear issues have checkbox changes
    When I run 'planr linear sync EPIC-004 --update-only'
    Then Checkbox states are synced bidirectionally for existing items only

  Scenario: Update-only with dry-run
    Given I want to see what would be updated without creating new items
    When I run 'planr linear sync EPIC-004 --update-only --dry-run'
    Then I see planned updates for existing items only

