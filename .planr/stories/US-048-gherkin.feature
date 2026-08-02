Feature: Bulk operation progress reporting and cancellation
  US-048 - As a As a developer, I want to I want to see progress and be able to cancel long-running bulk operations so that So that I can monitor bulk revision progress and stop operations that are taking too long or going wrong

  Background:
    Given the system is initialized

  Scenario: Progress reporting during bulk operation
    Given A bulk revision operation is running on 100 artifacts
    When The operation is in progress
    Then I see regular progress updates showing completed/total artifacts and current artifact being processed

  Scenario: Safe cancellation of bulk operation
    Given A bulk revision operation is running and I press Ctrl+C
    When The cancellation signal is received
    Then The current artifact completes processing, then the operation stops gracefully with a summary of completed work

  Scenario: Cancellation leaves repository in consistent state
    Given A bulk operation is cancelled mid-way through
    When The cancellation completes
    Then All completed revisions remain applied and the repository state is consistent with no partial writes

