Feature: Standardize error message format and structure
  US-006 - As a As a CLI user, I want to I want consistent error message formatting across all commands so that So that I can quickly understand and act on errors

  Background:
    Given the system is initialized

  Scenario: Consistent error format applied
    Given An error occurs in any command
    When The error message is displayed
    Then It should follow the standard format with problem description and next step

  Scenario: Error tone is helpful not technical
    Given A user encounters a validation error
    When The error message is shown
    Then It should use plain language and avoid technical jargon

