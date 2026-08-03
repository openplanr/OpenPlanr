Feature: Push local checkbox changes to Linear TaskList issues
  US-068 - As a As a developer, I want to I want to push local markdown checkbox changes to Linear TaskList issues so that So that my Linear issues reflect the current state of my local task progress

  Background:
    Given the system is initialized

  Scenario: Push local checkbox changes to Linear
    Given A local TaskList.md where I changed '- [ ] Run tests' to '- [x] Run tests'
    When I push changes to Linear
    Then The Linear TaskList issue description should update to show the checkbox as checked

  Scenario: Preserve Linear description formatting
    Given A Linear issue with custom formatting around checkboxes
    When I push checkbox updates
    Then Only checkbox states should change, all other formatting should remain intact

  Scenario: Handle new tasks added locally
    Given I added a new checkbox task to my local TaskList.md
    When I push to Linear
    Then The new task should be added to the Linear description in the correct position

