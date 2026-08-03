Feature: planr linear status — mapping-table viewer
  US-075 - As a developer, I want to see which OpenPlanr artifacts are mapped to which Linear items, so that I can debug drift between my local plan and Linear before running a push or sync.

  Background:
    Given the system is initialized
    And a `.planr/` hierarchy with a mix of pushed and unpushed artifacts exists

  Scenario: Shows pushed artifacts with their Linear identifiers and URLs
    Given EPIC-001 has `linearProjectId` and `linearProjectUrl` in its frontmatter
    And two Features under EPIC-001 have `linearIssueId` and `linearIssueUrl` in their frontmatter
    When the user runs `planr linear status`
    Then the table lists EPIC-001 with its Linear project identifier and clickable URL
    And each Feature row shows its Linear issue identifier and URL
    And no Linear API calls are made during the command

  Scenario: Flags unpushed artifacts distinctly
    Given EPIC-002 has no `linearProjectId` in its frontmatter
    When the user runs `planr linear status`
    Then EPIC-002's row renders the Linear columns as "(not pushed)"

  Scenario: Warns on stale-looking frontmatter
    Given FEAT-005 has `linearIssueId` in frontmatter but the id is malformed
    When the user runs `planr linear status`
    Then FEAT-005 is flagged with a "stale-id" marker and a suggestion to re-run `planr linear push`

  Scenario: Supports scoping to a single epic subtree
    Given `planr linear status --scope EPIC-001` is run
    When EPIC-001 and its descendants exist with mixed pushed/unpushed states
    Then the table is limited to EPIC-001 + its Features + their Stories + their TaskLists
    And artifacts outside the EPIC-001 subtree are not listed
