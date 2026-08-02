Feature: Create TaskList sub-issues with markdown checkboxes
  US-060 - As a As a developer, I want to I want TaskLists to become dedicated sub-issues with checkboxes so that So that I can track individual task completion in Linear while maintaining the task structure

  Background:
    Given the system is initialized

  Scenario: Create TaskList sub-issue with markdown checkboxes
    Given A Feature has an associated TaskList with multiple tasks
    When I push the TaskList to Linear
    Then A TaskList sub-issue is created under the Feature with markdown checkboxes for each task

  Scenario: Handle TaskList with existing Linear sub-issue
    Given A TaskList already has a Linear issue ID in frontmatter
    When I push the TaskList to Linear
    Then The existing TaskList sub-issue is updated with current checkbox state

  Scenario: Preserve task checkbox state in Linear
    Given Tasks have different completion states
    When The TaskList is pushed to Linear
    Then Markdown checkboxes reflect the current completion state of each task

