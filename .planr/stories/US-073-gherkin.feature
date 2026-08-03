Feature: Comprehensive help documentation
  US-073 - As a As a new user, I want to I want comprehensive help documentation for Linear commands so that So that I can understand all available options and use the integration effectively

  Background:
    Given the system is initialized

  Scenario: Main help shows all Linear commands
    Given I need to understand available Linear commands
    When I run 'planr linear --help'
    Then I see all available Linear subcommands with brief descriptions

  Scenario: Sync help shows all options
    Given I need to understand sync command options
    When I run 'planr linear sync --help'
    Then I see detailed help for sync command including --dry-run and --update-only flags with examples

  Scenario: Help includes usage examples
    Given I want to see practical usage examples
    When I view help for any Linear command
    Then I see real examples showing common use cases and flag combinations

