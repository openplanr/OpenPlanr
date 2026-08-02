Feature: Extract duplicated code patterns into shared utilities
  US-011 - As a As a developer, I want to I want duplicated code patterns extracted into reusable utility functions so that So that the codebase is more maintainable and consistent

  Background:
    Given the system is initialized

  Scenario: Extract validation patterns
    Given Multiple files contain similar validation logic
    When I extract the common validation patterns to shared utilities
    Then All files use the same validation utility functions

  Scenario: Extract file operation patterns
    Given Multiple command handlers have similar file reading/writing logic
    When I extract the common file operations to shared utilities
    Then File operations are consistent across all command handlers

