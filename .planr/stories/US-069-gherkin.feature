Feature: Resolve three-way merge conflicts with user confirmation
  US-069 - As a As a developer, I want to I want to resolve conflicts when both local and Linear checkboxes changed so that So that I don't lose work and can make informed decisions about conflicting changes

  Background:
    Given the system is initialized

  Scenario: Detect and present three-way merge conflict
    Given A task was checked locally, unchecked in Linear, and was previously unchecked
    When I sync bidirectionally
    Then I should see a conflict prompt showing local vs Linear states and be asked to choose

  Scenario: Apply user conflict resolution
    Given A three-way conflict where I choose to keep the Linear state
    When I confirm my choice
    Then The local file should update to match Linear and the conflict should be resolved

  Scenario: Handle multiple conflicts in one sync
    Given Multiple tasks have three-way conflicts in the same TaskList
    When I sync bidirectionally
    Then I should be prompted for each conflict individually and can resolve them one by one

