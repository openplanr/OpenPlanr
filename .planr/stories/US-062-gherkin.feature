Feature: Query Linear for issue status changes
  US-062 - As a As a product manager, I want to I want OpenPlanr to detect when issue statuses change in Linear so that So that my local planning artifacts stay synchronized with Linear workflow updates

  Background:
    Given the system is initialized

  Scenario: Successful status change detection
    Given Linear issues exist with stored IDs in OpenPlanr frontmatter
    When I run status sync and Linear issues have changed state since last sync
    Then The system detects all status changes and their new workflow states

  Scenario: No changes since last sync
    Given Linear issues exist with no status changes since last sync timestamp
    When I run status sync
    Then The system completes quickly without processing any updates

  Scenario: Linear API rate limit handling
    Given Multiple status sync operations are running concurrently
    When Linear API rate limits are exceeded
    Then The system backs off gracefully and retries with exponential delay

