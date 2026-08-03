Feature: Progress feedback during sync operations
  US-072 - As a As a user, I want to I want to see progress feedback during long-running sync operations so that So that I know the command is working and can estimate completion time

  Background:
    Given the system is initialized

  Scenario: Progress shown during large sync
    Given I am syncing a large epic with many features and stories
    When I run 'planr linear sync EPIC-004'
    Then I see progress indicators showing current operation and completion percentage

  Scenario: Progress shows operation details
    Given Sync is processing different types of items
    When The sync command is running
    Then I see specific details about what is being created or updated

  Scenario: Progress handles errors gracefully
    Given An error occurs during sync
    When The sync command encounters a failure
    Then I see the error with context about what was being processed

