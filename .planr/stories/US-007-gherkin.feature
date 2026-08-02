Feature: Add context-specific help suggestions to error messages
  US-007 - As a As a CLI user, I want to I want error messages to suggest specific actions based on what I was trying to do so that So that I can resolve issues quickly without consulting documentation

  Background:
    Given the system is initialized

  Scenario: Context-aware suggestions for file operations
    Given I try to create a story but the feature file doesn't exist
    When The error occurs
    Then The message should suggest creating the feature first with the specific command

  Scenario: Progressive disclosure for complex errors
    Given A validation error has multiple possible causes
    When The error is displayed
    Then It should show the most common fix first, with option to see advanced solutions

  Scenario: Command-specific guidance
    Given I use an invalid option with a command
    When The error occurs
    Then The message should show the correct syntax and available options for that specific command

