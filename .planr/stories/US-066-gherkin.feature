Feature: Parse checkbox states from Linear TaskList descriptions
  US-066 - As a As a developer, I want to I want to extract checkbox states from Linear TaskList issue descriptions so that So that I can sync checkbox changes from Linear to local markdown files

  Background:
    Given the system is initialized

  Scenario: Extract checkboxes from Linear description
    Given A Linear TaskList issue with description containing '- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3'
    When I parse the checkbox states
    Then I should get an array with tasks [false, true, false] matching the checkbox states

  Scenario: Handle mixed content with checkboxes
    Given A Linear description with 'Setup tasks:\n- [ ] Install deps\n\nNotes: Remember to test'
    When I parse the checkbox states
    Then I should extract only the checkbox items and preserve other content separately

  Scenario: Handle empty or no checkboxes
    Given A Linear TaskList issue with no checkbox content
    When I parse the checkbox states
    Then I should return an empty array without errors

