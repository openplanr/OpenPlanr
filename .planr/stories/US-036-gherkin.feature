Feature: Register planr revise CLI command with argument parsing
  US-036 - As a As a user, I want to I want to run planr revise commands from the CLI so that So that I can test the revision engine on my artifacts

  Background:
    Given the system is initialized

  Scenario: Run dry-run revision on specific artifact
    Given A valid artifact ID in my project
    When I run 'planr revise EPIC-002 --dry-run'
    Then It processes the artifact and shows revision decisions without writing files

  Scenario: Handle invalid artifact ID
    Given An invalid or non-existent artifact ID
    When I run 'planr revise INVALID-ID --dry-run'
    Then It shows a clear error message about the missing artifact

  Scenario: Show help for revise command
    Given The planr CLI is available
    When I run 'planr revise --help'
    Then It displays usage information and available options

