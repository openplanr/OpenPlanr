Feature: Update local markdown when Linear checkboxes change
  US-067 - As a As a developer, I want to I want local TaskList markdown files to update when Linear checkbox states change so that So that my local files stay in sync with Linear without manual updates

  Background:
    Given the system is initialized

  Scenario: Sync checkbox state changes from Linear
    Given A local TaskList.md with '- [ ] Install dependencies' and Linear shows it as checked
    When I sync from Linear
    Then The local file should update to '- [x] Install dependencies'

  Scenario: Match tasks by content when order differs
    Given Local and Linear have same tasks but in different order
    When I sync checkbox states
    Then Tasks should match by content and update correct checkboxes regardless of position

  Scenario: Handle task content drift with fallback matching
    Given A task changed from 'Setup DB' locally to 'Setup database' in Linear
    When I sync checkbox states
    Then The system should use fuzzy matching or task numbers to find the correct task

