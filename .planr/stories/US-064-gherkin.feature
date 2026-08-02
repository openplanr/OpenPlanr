Feature: Update OpenPlanr frontmatter with Linear status changes
  US-064 - As a As a product manager, I want to I want Linear status changes to automatically update my local artifact frontmatter so that So that my planning files reflect the current state of work without manual updates

  Background:
    Given the system is initialized

  Scenario: Feature status update from Linear
    Given A Feature has linearId in frontmatter and its Linear issue status changed
    When Status sync processes the update
    Then The Feature frontmatter status field updates to match the mapped Linear state

  Scenario: Story status update from Linear
    Given A Story has linearId in frontmatter and its Linear issue status changed
    When Status sync processes the update
    Then The Story frontmatter status field updates to match the mapped Linear state

  Scenario: TaskList status ignored
    Given A TaskList has linearId in frontmatter and its Linear issue status changed
    When Status sync processes the update
    Then The TaskList frontmatter remains unchanged as TaskLists do not support status sync

